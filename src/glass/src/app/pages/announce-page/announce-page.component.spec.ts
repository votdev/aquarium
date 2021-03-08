import { HttpClientTestingModule } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule } from '@ngx-translate/core';

import { AnnouncePageComponent } from '~/app/pages/announce-page/announce-page.component';
import { PagesModule } from '~/app/pages/pages.module';

describe('AnnouncePageComponent', () => {
  let component: AnnouncePageComponent;
  let fixture: ComponentFixture<AnnouncePageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        HttpClientTestingModule,
        PagesModule,
        NoopAnimationsModule,
        RouterTestingModule,
        TranslateModule.forRoot()
      ]
    }).compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(AnnouncePageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should validate addr [1]', () => {
    const control = component.formGroup.get('addr');
    control?.setValue('foo.local');
    expect(control?.valid).toBeTruthy();
  });

  it('should validate addr [2]', () => {
    const control = component.formGroup.get('addr');
    control?.setValue('172.160.0.1');
    expect(control?.valid).toBeTruthy();
  });

  it('should not validate addr [1]', () => {
    const control = component.formGroup.get('addr');
    control?.setValue('');
    expect(control?.errors).toEqual({ required: true });
  });

  it('should not validate addr [2]', () => {
    const control = component.formGroup.get('addr');
    control?.setValue('123.456');
    expect(control?.invalid).toBeTruthy();
    expect(control?.errors).toEqual({ addr: true });
  });

  it('should not validate addr [3]', () => {
    const control = component.formGroup.get('addr');
    control?.setValue('foo.ba_z.com');
    expect(control?.invalid).toBeTruthy();
    expect(control?.errors).toEqual({ addr: true });
  });

  it('should validate token [1]', () => {
    const control = component.formGroup.get('token');
    control?.setValue('1234-abCD-9876-FD01');
    expect(control?.valid).toBeTruthy();
  });

  it('should not validate token [1]', () => {
    const control = component.formGroup.get('token');
    control?.setValue('');
    expect(control?.errors).toEqual({ required: true });
  });

  it('should not validate token [2]', () => {
    const control = component.formGroup.get('token');
    control?.setValue('1234+abCD-9876-FD01');
    expect(control?.invalid).toBeTruthy();
  });

  it('should not validate token [3]', () => {
    const control = component.formGroup.get('token');
    control?.setValue('foo');
    expect(control?.invalid).toBeTruthy();
    expect(Object.keys(control?.errors as Record<string, any>)).toContain('pattern');
  });
});
