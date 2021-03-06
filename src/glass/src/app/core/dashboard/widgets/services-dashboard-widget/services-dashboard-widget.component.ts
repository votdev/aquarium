import { Component } from '@angular/core';
import { marker as TEXT } from '@biesbjerg/ngx-translate-extract-marker';
import { Observable } from 'rxjs';

import { AbstractDashboardWidget } from '~/app/core/dashboard/widgets/abstract-dashboard-widget';
import { DatatableColumn } from '~/app/shared/models/datatable-column.type';
import { BytesToSizePipe } from '~/app/shared/pipes/bytes-to-size.pipe';
import { ServiceDesc, ServicesService } from '~/app/shared/services/api/services.service';

@Component({
  selector: 'glass-services-dashboard-widget',
  templateUrl: './services-dashboard-widget.component.html',
  styleUrls: ['./services-dashboard-widget.component.scss']
})
export class ServicesDashboardWidgetComponent extends AbstractDashboardWidget<ServiceDesc[]> {
  data: ServiceDesc[] = [];
  columns: DatatableColumn[] = [
    {
      name: TEXT('Name'),
      prop: 'name',
      sortable: true
    },
    {
      name: TEXT('Type'),
      prop: 'type',
      sortable: true
    },
    {
      name: TEXT('Space'),
      prop: 'reservation',
      sortable: true,
      pipe: new BytesToSizePipe()
    },
    {
      name: TEXT('Replicas'),
      prop: 'replicas',
      sortable: true
    }
  ];

  constructor(private service: ServicesService) {
    super();
  }

  loadData(): Observable<ServiceDesc[]> {
    return this.service.list();
  }
}
