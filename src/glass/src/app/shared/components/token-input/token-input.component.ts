/* eslint-disable no-underscore-dangle */
import { FocusMonitor } from '@angular/cdk/a11y';
import { BooleanInput, coerceBooleanProperty } from '@angular/cdk/coercion';
import {
  Component,
  ElementRef,
  HostBinding,
  Input,
  OnChanges,
  OnDestroy,
  Optional,
  Self,
  ViewChild
} from '@angular/core';
import {
  AbstractControl,
  ControlValueAccessor,
  FormBuilder,
  FormGroup,
  NgControl,
  Validators
} from '@angular/forms';
import { MatFormFieldControl } from '@angular/material/form-field';
import * as _ from 'lodash';
import { Subject, Subscription } from 'rxjs';

let nextUniqueId = 0;

type TokenFormat = {
  segment1: string;
  segment2: string;
  segment3: string;
  segment4: string;
};

@Component({
  selector: 'glass-token-input',
  templateUrl: './token-input.component.html',
  styleUrls: ['./token-input.component.scss'],
  providers: [
    {
      provide: MatFormFieldControl,
      useExisting: TokenInputComponent
    }
  ]
})
export class TokenInputComponent
  implements ControlValueAccessor, MatFormFieldControl<string>, OnDestroy, OnChanges {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  static ngAcceptInputType_disabled: BooleanInput;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  static ngAcceptInputType_required: BooleanInput;

  @ViewChild('segment1')
  segment1Input!: ElementRef<HTMLInputElement>;
  @ViewChild('segment2')
  segment2Input!: ElementRef<HTMLInputElement>;
  @ViewChild('segment3')
  segment3Input!: ElementRef<HTMLInputElement>;
  @ViewChild('segment4')
  segment4Input!: ElementRef<HTMLInputElement>;

  @Input()
  get value(): string | null {
    return this.empty ? null : this._value;
  }
  set value(value: string | null) {
    if (!_.isEqual(value, this.value)) {
      this._value = value;
      this.syncValue(this._value);
      this.onChange(this._value);
      this.stateChanges.next();
    }
  }

  @Input()
  get id(): string {
    return this._uniqueId;
  }

  @Input()
  get placeholder(): string {
    return this._placeholder;
  }
  set placeholder(value: string) {
    this._placeholder = value;
    this.stateChanges.next();
  }

  @Input()
  get required(): boolean {
    return this._required;
  }
  set required(value: boolean) {
    this._required = coerceBooleanProperty(value);
    this.stateChanges.next();
  }

  @Input()
  get disabled(): boolean {
    return this._disabled;
  }
  set disabled(value: boolean) {
    this._disabled = coerceBooleanProperty(value);
    if (this._disabled) {
      this.formGroup.disable();
    } else {
      this.formGroup.enable();
    }
    this.stateChanges.next();
  }

  public controlType = 'glass-token-input';
  public _value: string | null = null;
  public _placeholder = '';
  public _disabled = false;
  public _required = false;
  public focused = false;
  public stateChanges = new Subject<void>();
  public formGroup: FormGroup;

  private _uniqueId = `glass-token-input-${++nextUniqueId}`;
  private subscription?: Subscription;

  // eslint-disable-next-line @typescript-eslint/member-ordering
  constructor(
    @Optional() @Self() public ngControl: NgControl,
    formBuilder: FormBuilder,
    private focusMonitor: FocusMonitor,
    private elementRef: ElementRef<HTMLElement>
  ) {
    this.formGroup = formBuilder.group({
      segment1: [null, [Validators.required, Validators.pattern(/^[a-f0-9]{4}$/i)]],
      segment2: [null, [Validators.required, Validators.pattern(/^[a-f0-9]{4}$/i)]],
      segment3: [null, [Validators.required, Validators.pattern(/^[a-f0-9]{4}$/i)]],
      segment4: [null, [Validators.required, Validators.pattern(/^[a-f0-9]{4}$/i)]]
    });
    this.subscription = this.formGroup.valueChanges.subscribe((value) => {
      this._value = this.formatValue(value);
      this.onChange(this._value);
      this.stateChanges.next();
    });
    if (!_.isNull(this.ngControl)) {
      this.ngControl.valueAccessor = this;
    }
    focusMonitor.monitor(elementRef, true).subscribe((origin) => {
      if (this.focused && !origin) {
        this.onTouched();
      }
      this.focused = !!origin;
      this.stateChanges.next();
    });
  }

  ngOnDestroy(): void {
    this.stateChanges.complete();
    this.focusMonitor.stopMonitoring(this.elementRef);
    this.subscription?.unsubscribe();
  }

  ngOnChanges(): void {
    this.stateChanges.next();
  }

  get empty(): boolean {
    const value: TokenFormat = this.formGroup.value;
    return _.every(value, _.isEmpty);
  }

  get errorState(): boolean {
    return (
      coerceBooleanProperty(this.ngControl.errors) && coerceBooleanProperty(this.ngControl.touched)
    );
  }

  @HostBinding('class.floating')
  get shouldLabelFloat() {
    return this.focused || !this.empty;
  }

  writeValue(value: any) {
    this.value = value;
  }

  setDescribedByIds(ids: string[]): void {}

  registerOnChange(fn: (value: any) => void) {
    this.onChange = fn;
  }

  registerOnTouched(fn: any) {
    this.onTouched = fn;
  }

  onContainerClick(event: MouseEvent): void {
    // Select the first empty segment.
    _.forEach(
      [this.segment1Input, this.segment2Input, this.segment3Input, this.segment4Input],
      (element) => {
        if (_.isEmpty(element.nativeElement.value)) {
          this.autoFocus(element.nativeElement);
          return false;
        }
        return; // Make ts-lint happy.
      }
    );
  }

  onPaste(event: ClipboardEvent) {
    // @ts-ignore
    const clipboardData = event.clipboardData || window.clipboardData;
    this.value = clipboardData.getData('text');
  }

  doInput(control: AbstractControl, nextElement?: HTMLInputElement): void {
    this.autoFocusNext(control, nextElement);
    this.onChange(this.value);
  }

  autoFocusNext(control: AbstractControl, nextElement?: HTMLInputElement): void {
    if (!control.errors && nextElement) {
      this.autoFocus(nextElement);
    }
  }

  autoFocusPrev(control: AbstractControl, prevElement: HTMLInputElement): void {
    if (control.value.length < 1) {
      this.autoFocus(prevElement);
    }
  }

  autoFocus(element: HTMLInputElement): void {
    this.focusMonitor.focusVia(element, 'program');
  }

  private onChange = (_value: any) => {};

  private onTouched = () => {};

  private formatValue(value: TokenFormat): string {
    return _.filter(
      [value.segment1, value.segment2, value.segment3, value.segment4],
      (segment) => !_.isEmpty(segment)
    ).join('-');
  }

  private syncValue(value: string | null): void {
    if (!_.isString(value)) {
      return;
    }
    const segments = value.split('-');
    this.formGroup.setValue({
      segment1: _.defaultTo(segments[0], ''),
      segment2: _.defaultTo(segments[1], ''),
      segment3: _.defaultTo(segments[2], ''),
      segment4: _.defaultTo(segments[3], '')
    });
  }
}
