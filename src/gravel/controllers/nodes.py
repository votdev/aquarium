# project aquarium's backend
# Copyright (C) 2021 SUSE, LLC.

from __future__ import annotations
import asyncio
from enum import Enum
from logging import Logger
import random
from typing import (
    Any,
    Dict,
    List,
    Optional, Tuple,
    Union,
    cast
)
from uuid import UUID, uuid4
from pathlib import Path
from datetime import datetime as dt
import websockets

from fastapi.logger import logger as fastapi_logger
from pydantic import BaseModel
from starlette.endpoints import WebSocketEndpoint
from starlette.websockets import WebSocket
from gravel.controllers.config import DeploymentStage

from gravel.controllers.gstate import gstate
from gravel.controllers.orch.orchestrator import Orchestrator


logger: Logger = fastapi_logger


class NodeError(Exception):
    def __init__(self, msg: Optional[str] = ""):
        super().__init__()
        self._msg = msg


class NodeNotStartedError(NodeError):
    pass


class NodeShuttingDownError(NodeError):
    pass


class NodeBootstrappingError(NodeError):
    pass


class NodeHasBeenDeployedError(NodeError):
    pass


class NodeAlreadyJoiningError(NodeError):
    pass


class NodeHasJoinedError(NodeError):
    pass


class NodeCantBootstrapError(NodeError):
    pass


class MessageTypeEnum(int, Enum):
    JOIN = 1
    WELCOME = 2
    READY_TO_ADD = 3


class NodeOpType(int, Enum):
    NONE = 0
    JOIN = 1


class MessageModel(BaseModel):
    type: MessageTypeEnum
    data: Any


class JoinMessageModel(BaseModel):
    uuid: UUID
    hostname: str
    address: str
    token: str


class WelcomeMessageModel(BaseModel):
    aquarium_uuid: UUID
    pubkey: str


class OkayToAddModel(BaseModel):
    pass


class Peer:
    endpoint: str
    conn: Union[IncomingConnection, OutgoingConnection]

    def __init__(self, endpoint: str, conn: Union[IncomingConnection, OutgoingConnection]):
        self.endpoint = endpoint
        self.conn = conn


class NodeRoleEnum(int, Enum):
    NONE = 0
    LEADER = 1
    FOLLOWER = 2


class NodeStageEnum(int, Enum):
    NONE = 0
    BOOTSTRAPPING = 1
    BOOTSTRAPPED = 2
    JOINING = 3
    READY = 4


class NodeStateModel(BaseModel):
    uuid: UUID
    role: NodeRoleEnum
    stage: NodeStageEnum
    address: Optional[str]
    hostname: Optional[str]


class ManifestModel(BaseModel):
    aquarium_uuid: UUID
    version: int
    modified: dt
    nodes: List[NodeStateModel]


class TokenModel(BaseModel):
    token: str


class AquariumUUIDModel(BaseModel):
    aqarium_uuid: UUID


class ConnMgr:

    _conns: List[Peer]
    _conn_by_endpoint: Dict[str, Peer]

    _passive_conns: List[Peer]
    _active_conns: List[Peer]

    _incoming_queue: asyncio.Queue[Tuple[IncomingConnection, MessageModel]]

    def __init__(self):
        self._conns = []
        self._passive_conns = []
        self._active_conns = []
        self._conn_by_endpoint = {}
        self._incoming_queue = asyncio.Queue()

    def register_connect(
        self,
        endpoint: str,
        conn: Union[OutgoingConnection, IncomingConnection],
        is_passive: bool
    ) -> None:
        peer = Peer(endpoint=endpoint, conn=conn)
        self._conns.append(peer)
        self._conn_by_endpoint[endpoint] = peer

        if is_passive:
            self._passive_conns.append(peer)
        else:
            self._active_conns.append(peer)

    async def on_incoming_receive(
        self,
        conn: IncomingConnection,
        msg: MessageModel
    ) -> None:
        logger.debug(f"=> connmgr -- incoming recv: {conn}, {msg}")
        await self._incoming_queue.put((conn, msg))
        logger.debug(f"=> connmgr -- queue len: {self._incoming_queue.qsize()}")

    async def wait_incoming_msg(
        self
    ) -> Tuple[IncomingConnection, MessageModel]:
        return await self._incoming_queue.get()

    async def connect(self, endpoint: str) -> OutgoingConnection:

        if endpoint in self._conn_by_endpoint:
            conn = self._conn_by_endpoint[endpoint].conn
            return cast(OutgoingConnection, conn)

        wsclient = await websockets.connect(endpoint)
        conn = OutgoingConnection(wsclient)
        self.register_connect(endpoint, conn, is_passive=False)
        return conn


class NodeMgr:

    _connmgr: ConnMgr
    _incoming_task: asyncio.Task
    _shutting_down: bool
    _state: NodeStateModel
    _manifest: Optional[ManifestModel]
    _token: Optional[str]
    _aquarium_uuid: Optional[UUID]

    def __init__(self):
        self._shutting_down = False
        self._connmgr = ConnMgr()
        self._manifest = None
        self._token = None
        self._aquarium_uuid = None

        self._init_node()
        assert self._state
        if self._state.stage == NodeStageEnum.READY:
            self.start()

    def start(self):
        self._load()
        self._incoming_task = asyncio.create_task(self._incoming_msg_task())

    async def join(self, leader_address: str, token: str) -> bool:
        logger.debug(
            f"=> mgr -- join > with leader {leader_address}, token: {token}"
        )

        assert self._state
        if self._state.stage == NodeStageEnum.BOOTSTRAPPING:
            raise NodeBootstrappingError()
        elif self._state.stage == NodeStageEnum.BOOTSTRAPPED:
            raise NodeHasBeenDeployedError()
        elif self._state.stage == NodeStageEnum.JOINING:
            raise NodeAlreadyJoiningError()
        elif self._state.stage == NodeStageEnum.READY:
            raise NodeHasJoinedError()
        assert self._state.stage == NodeStageEnum.NONE
        assert self._state.role == NodeRoleEnum.NONE

        uri: str = f"ws://{leader_address}/api/nodes/ws"
        conn = await self._connmgr.connect(uri)
        logger.debug(f"=> mgr -- join > conn: {conn}")

        uuid: UUID = self._state.uuid
        hostname: str = self._get_hostname()
        address: str = self._get_address()

        joinmsg = JoinMessageModel(
            uuid=uuid,
            hostname=hostname,
            address=address,
            token=token
        )
        msg = MessageModel(type=MessageTypeEnum.JOIN, data=joinmsg.dict())
        await conn.send(msg)

        reply: MessageModel = await conn.receive()
        logger.debug(f"=> mgr -- join > recv: {reply}")
        assert reply.type == MessageTypeEnum.WELCOME
        welcome = WelcomeMessageModel.parse_obj(reply.data)
        assert welcome.aquarium_uuid
        assert welcome.pubkey

        authorized_keys: Path = Path("/root/.ssh/authorized_keys")
        if not authorized_keys.parent.exists():
            authorized_keys.parent.mkdir(0o700)
        with authorized_keys.open("a") as fd:
            fd.writelines([welcome.pubkey])
            logger.debug(f"=> mgr -- join > wrote pubkey to {authorized_keys}")

        self._write_aquarium_uuid(welcome.aquarium_uuid)

        return True

    async def prepare_bootstrap(self) -> None:
        assert self._state
        if self._state.stage > NodeStageEnum.NONE:
            raise NodeCantBootstrapError()

    async def start_bootstrap(self, address: str, hostname: str) -> None:
        assert self._state
        assert self._state.stage == NodeStageEnum.NONE
        self._state.stage = NodeStageEnum.BOOTSTRAPPING
        self._state.address = address
        self._state.hostname = hostname

        statefile: Path = self._get_node_file("node")
        statefile.write_text(self._state.json())

    async def finish_bootstrap(self):
        assert self._state
        assert self._state.stage == NodeStageEnum.BOOTSTRAPPING
        manifestfile: Path = self._get_node_file("manifest")
        tokenfile: Path = self._get_node_file("token")
        statefile: Path = self._get_node_file("node")

        assert not manifestfile.exists()
        assert not tokenfile.exists()
        assert statefile.exists()

        self._state.stage = NodeStageEnum.BOOTSTRAPPED
        statefile.write_text(self._state.json())

        manifest: ManifestModel = ManifestModel(
            aquarium_uuid=uuid4(),
            version=1,
            modified=dt.now(),
            nodes=[self._state]
        )
        manifestfile.write_text(manifest.json())

        def gen() -> str:
            return ''.join(random.choice("0123456789abcdef") for _ in range(4))

        tokenstr = '-'.join(gen() for _ in range(4))
        token: TokenModel = TokenModel(token=tokenstr)
        tokenfile.write_text(token.json())

        self._load()

    @property
    def stage(self) -> NodeStageEnum:
        assert self._state
        return self._state.stage

    @property
    def bootstrapping(self) -> bool:
        if not self._state:
            return False
        return self._state.stage == NodeStageEnum.BOOTSTRAPPING

    @property
    def bootstrapped(self) -> bool:
        if not self._state:
            return False
        return self._state.stage == NodeStageEnum.BOOTSTRAPPED

    @property
    def ready(self) -> bool:
        if not self._state:
            return False
        return self._state.stage == NodeStageEnum.READY

    @property
    def connmgr(self) -> ConnMgr:
        if not self._connmgr:
            raise NodeNotStartedError()
        elif self._shutting_down:
            raise NodeShuttingDownError()
        return self._connmgr

    @property
    def token(self) -> Optional[str]:
        return self._token

    def _get_node_file(self, what: str) -> Path:
        confdir: Path = gstate.config.confdir
        assert confdir.exists()
        assert confdir.is_dir()
        return confdir.joinpath(f"{what}.json")

    def _init_node(self) -> None:
        statefile: Path = self._get_node_file("node")
        if not statefile.exists():
            # other control files must not exist either
            manifestfile: Path = self._get_node_file("manifest")
            tokenfile: Path = self._get_node_file("token")
            assert not manifestfile.exists()
            assert not tokenfile.exists()

            state = NodeStateModel(
                uuid=uuid4(),
                role=NodeRoleEnum.NONE,
                stage=NodeStageEnum.NONE,
                address=None,
                hostname=None
            )
            try:
                statefile.write_text(state.json())
            except Exception as e:
                raise NodeError(str(e))
            assert statefile.exists()

        self._state = NodeStateModel.parse_file(statefile)

    def _load(self) -> None:
        self._manifest = self._load_manifest()
        self._token = self._load_token()
        self._aquarium_uuid = self._load_aquarium_uuid()

        assert (self._state and self._manifest) or \
               (not self._state and not self._manifest)

    def _load_manifest(self) -> Optional[ManifestModel]:
        confdir: Path = gstate.config.confdir
        assert confdir.exists()
        assert confdir.is_dir()
        manifestfile: Path = confdir.joinpath("manifest.json")
        if not manifestfile.exists():
            stage = gstate.config.deployment_state.stage
            assert stage < DeploymentStage.bootstrapped
            return None
        return ManifestModel.parse_file(manifestfile)

    def _load_token(self) -> Optional[str]:
        confdir: Path = gstate.config.confdir
        assert confdir.exists()
        assert confdir.is_dir()
        tokenfile: Path = confdir.joinpath("token.json")
        if not tokenfile.exists():
            stage = gstate.config.deployment_state.stage
            assert stage < DeploymentStage.bootstrapped
            return None
        token = TokenModel.parse_file(tokenfile)
        return token.token

    def _load_aquarium_uuid(self) -> Optional[UUID]:
        confdir: Path = gstate.config.confdir
        assert confdir.exists()
        assert confdir.is_dir()
        uuidfile: Path = confdir.joinpath("aquarium_uuid.json")
        if not uuidfile.exists():
            stage = gstate.config.deployment_state.stage
            assert stage < DeploymentStage.ready
            return None
        uuid = AquariumUUIDModel.parse_file(uuidfile)
        return uuid.aqarium_uuid

    def _write_aquarium_uuid(self, uuid: UUID) -> None:
        pass

    def _get_hostname(self) -> str:
        return ""

    def _get_address(self) -> str:
        return ""

    async def _incoming_msg_task(self) -> None:
        while not self._shutting_down:
            logger.debug("=> mgr -- incoming msg task > wait")
            conn, msg = await self._connmgr.wait_incoming_msg()
            logger.debug(f"=> mgr -- incoming msg task > {conn}, {msg}")
            await self._handle_incoming_msg(conn, msg)
            logger.debug("=> mgr -- incoming msg task > handled")

    async def _handle_incoming_msg(
        self,
        conn: IncomingConnection,
        msg: MessageModel
    ) -> None:
        logger.debug(f"=> mgr -- handle msg > type: {msg.type}")
        if msg.type == MessageTypeEnum.JOIN:
            logger.debug("=> mgr -- handle msg > join")
            await self._handle_join(conn, JoinMessageModel.parse_obj(msg.data))
        pass

    async def _handle_join(
        self,
        conn: IncomingConnection,
        msg: JoinMessageModel
    ) -> None:
        logger.debug(f"=> mgr -- handle join {msg}")
        assert self._state is not None

        orch = Orchestrator()
        pubkey: str = orch.get_public_key()

        welcome = WelcomeMessageModel(
            cluster_uuid=self._state.uuid,
            pubkey=pubkey
        )
        try:
            await conn.send_msg(
                MessageModel(
                    type=MessageTypeEnum.WELCOME,
                    data=welcome.dict()
                )
            )
        except Exception as e:
            logger.error(f"=> mgr -- handle join > error: {str(e)}")
        logger.debug(f"=> mgr -- handle join > welcome sent: {welcome}")


_nodemgr = NodeMgr()


def get_node_mgr() -> NodeMgr:
    return _nodemgr


def get_conn_mgr() -> ConnMgr:
    return get_node_mgr().connmgr


class IncomingConnection(WebSocketEndpoint):

    _ws: Optional[WebSocket] = None

    async def on_connect(self, websocket: WebSocket) -> None:
        logger.debug(f"=> connection -- from {websocket.client}")
        self._ws = websocket
        host: str = \
            f"{websocket.client.host}"  # pyright: reportUnknownMemberType=false
        port: str = \
            f"{websocket.client.port}"  # pyright: reportUnknownMemberType=false
        endpoint: str = f"{host}:{port}"
        await websocket.accept()
        get_conn_mgr().register_connect(endpoint, self, is_passive=True)

    async def on_disconnect(
        self,
        websocket: WebSocket,
        close_code: int
    ) -> None:
        logger.debug(f"=> connection -- disconnect from {websocket.client}")
        self._ws = None

    async def on_receive(self, websocket: WebSocket, data: Any) -> None:
        logger.debug(f"=> connection -- recv from {websocket.client}: {data}")
        msg: MessageModel = MessageModel.parse_raw(data)
        await get_conn_mgr().on_incoming_receive(self, msg)

    async def send_msg(self, data: MessageModel) -> None:
        logger.debug(f"=> connection -- send to {self._ws} data {data}")
        assert self._ws
        await self._ws.send_text(data.json())


class OutgoingConnection:
    _ws: websockets.WebSocketClientProtocol

    def __init__(self, ws: websockets.WebSocketClientProtocol) -> None:
        self._ws = ws

    async def send(self, msg: MessageModel) -> None:
        assert self._ws
        await self._ws.send(msg.json())

    async def receive(self) -> MessageModel:
        assert self._ws
        raw = await self._ws.recv()
        return MessageModel.parse_raw(raw)
