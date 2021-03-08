import { Component, OnInit } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  FormGroup,
  ValidationErrors,
  ValidatorFn,
  Validators
} from '@angular/forms';
import { Router } from '@angular/router';
import { marker as TEXT } from '@biesbjerg/ngx-translate-extract-marker';
import * as _ from 'lodash';
import { BlockUI, NgBlockUI } from 'ng-block-ui';
import validator from 'validator';

import { translate } from '~/app/i18n.helper';
import { NodesService } from '~/app/shared/services/api/nodes.service';

const TOKEN_REGEXP = /^[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}$/i;

@Component({
  selector: 'glass-announce-page',
  templateUrl: './announce-page.component.html',
  styleUrls: ['./announce-page.component.scss']
})
export class AnnouncePageComponent implements OnInit {
  @BlockUI()
  blockUI!: NgBlockUI;

  visible = true;
  public formGroup: FormGroup;

  constructor(
    private formBuilder: FormBuilder,
    private nodesService: NodesService,
    private router: Router
  ) {
    this.formGroup = this.formBuilder.group({
      addr: ['', [Validators.required, this.addrValidator()]],
      token: ['', [Validators.required, Validators.pattern(TOKEN_REGEXP)]]
    });
  }

  ngOnInit(): void {
    this.blockUI.resetGlobal();
  }

  doJoin(): void {
    if (this.formGroup.pristine || this.formGroup.invalid) {
      return;
    }
    const values = this.formGroup.value;
    this.visible = false;
    this.blockUI.start(translate(TEXT('Please wait, joining existing cluster ...')));
    this.nodesService.join(values).subscribe({
      next: () => {
        this.blockUI.stop();
        this.router.navigate(['/installer/join/deployment']);
      },
      error: () => {
        this.visible = true;
        this.blockUI.stop();
      }
    });
  }

  protected addrValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      if (_.isEmpty(control.value)) {
        return null;
      }
      const valid =
        // eslint-disable-next-line @typescript-eslint/naming-convention
        validator.isIP(control.value) || validator.isFQDN(control.value, { require_tld: false });
      return !valid ? { addr: true } : null;
    };
  }
}
