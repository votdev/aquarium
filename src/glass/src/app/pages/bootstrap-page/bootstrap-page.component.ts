import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { BlockUI, NgBlockUI } from 'ng-block-ui';
import { of, Subscription } from 'rxjs';
import { delay, mergeMap } from 'rxjs/operators';

import {
  BootstrapBasicReply,
  BootstrapService,
  BootstrapStatusReply
} from '~/app/shared/services/api/bootstrap.service';
import { NotificationService } from '~/app/shared/services/notification.service';

@Component({
  selector: 'glass-bootstrap-page',
  templateUrl: './bootstrap-page.component.html',
  styleUrls: ['./bootstrap-page.component.scss']
})
export class BootstrapPageComponent implements OnInit, OnDestroy {
  @BlockUI()
  blockUI!: NgBlockUI;

  visible = false;
  private subscriptions: Subscription = new Subscription();

  constructor(
    private bootstrapService: BootstrapService,
    private notificationService: NotificationService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.blockUI.resetGlobal();
    // Immediately block the UI if bootstrapping is in progress.
    this.subscriptions.add(
      this.bootstrapService.status().subscribe({
        next: (statusReply: BootstrapStatusReply) => {
          if (statusReply.stage === 'running') {
            this.visible = false;
            this.blockUI.start(
              `Please wait, bootstrapping in progress (${statusReply.progress}%) ...`
            );
            this.pollBootstrapStatus();
          }
          if (statusReply.stage === 'none') {
            this.visible = true;
          }
        },
        error: () => (this.visible = true)
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  startBootstrap(): void {
    this.visible = false;
    this.blockUI.start('Please wait, bootstrapping in progress ...');
    this.subscriptions.add(
      this.bootstrapService.start().subscribe({
        next: (basicReplay: BootstrapBasicReply) => {
          if (basicReplay.success) {
            this.pollBootstrapStatus();
          } else {
            this.visible = true;
            this.blockUI.stop();
            this.notificationService.show('Failed to start bootstrapping the system.', {
              type: 'error'
            });
          }
        },
        error: () => {
          this.visible = true;
          this.blockUI.stop();
        }
      })
    );
  }

  pollBootstrapStatus(): void {
    const handleError = () => {
      this.visible = true;
      this.blockUI.stop();
      this.notificationService.show('Failed to bootstrap the system.', {
        type: 'error'
      });
    };
    this.subscriptions.add(
      of(true)
        .pipe(
          delay(5000),
          mergeMap(() => this.bootstrapService.status())
        )
        .subscribe(
          (statusReply: BootstrapStatusReply) => {
            switch (statusReply.stage) {
              case 'error':
                handleError();
                break;
              case 'running':
              case 'none':
                this.blockUI.update(
                  `Please wait, bootstrapping in progress (${statusReply.progress}%) ...`
                );
                this.pollBootstrapStatus();
                break;
              case 'done':
                this.blockUI.stop();
                this.router.navigate(['/installer/create/deployment']);
                break;
            }
          },
          () => handleError()
        )
    );
  }
}
