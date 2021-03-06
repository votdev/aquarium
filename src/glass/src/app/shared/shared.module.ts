import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';

import { MaterialModule } from '~/app/material.modules';
import { ComponentsModule } from '~/app/shared/components/components.module';
import { BytesToSizePipe } from '~/app/shared/pipes/bytes-to-size.pipe';
import { SortByPipe } from '~/app/shared/pipes/sort-by.pipe';

import { RelativeDatePipe } from './pipes/relative-date.pipe';

@NgModule({
  declarations: [BytesToSizePipe, SortByPipe, RelativeDatePipe],
  providers: [BytesToSizePipe, SortByPipe, RelativeDatePipe],
  exports: [BytesToSizePipe, ComponentsModule, SortByPipe, RelativeDatePipe],
  imports: [CommonModule, ComponentsModule, MaterialModule]
})
export class SharedModule {}
