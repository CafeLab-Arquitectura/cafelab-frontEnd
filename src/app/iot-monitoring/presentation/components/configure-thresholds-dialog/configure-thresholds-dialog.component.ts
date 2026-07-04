import { CommonModule } from '@angular/common';
import { Component, Inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslateModule } from '@ngx-translate/core';

import { ThresholdRange } from '../../../domain/model/environmental-reading.entity';

@Component({
  selector: 'app-configure-thresholds-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    TranslateModule,
  ],
  templateUrl: './configure-thresholds-dialog.component.html',
  styleUrl: './configure-thresholds-dialog.component.css',
})
export class ConfigureThresholdsDialogComponent {
  readonly form;

  constructor(
    private readonly fb: FormBuilder,
    private readonly dialogRef: MatDialogRef<ConfigureThresholdsDialogComponent>,
    @Inject(MAT_DIALOG_DATA) private readonly data: ThresholdRange
  ) {
    this.form = this.fb.group(
      {
        minTemperature: [
          this.data.minTemperature,
          [Validators.required, Validators.min(0), Validators.max(150)],
        ],
        maxTemperature: [
          this.data.maxTemperature,
          [Validators.required, Validators.min(0), Validators.max(150)],
        ],
        minHumidity: [this.data.minHumidity, [Validators.required, Validators.min(0), Validators.max(150)]],
        maxHumidity: [this.data.maxHumidity, [Validators.required, Validators.min(0), Validators.max(150)]],
      },
      {
        validators: [
          this.minLessThanMax('minTemperature', 'maxTemperature'),
          this.minLessThanMax('minHumidity', 'maxHumidity'),
        ],
      }
    );
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.dialogRef.close(this.form.getRawValue() as ThresholdRange);
  }

  cancel(): void {
    this.dialogRef.close();
  }

  private minLessThanMax(minControlName: string, maxControlName: string): ValidatorFn {
    return (group): ValidationErrors | null => {
      const minControl = group.get(minControlName);
      const maxControl = group.get(maxControlName);

      if (!minControl || !maxControl || minControl.value == null || maxControl.value == null) {
        return null;
      }

      return Number(minControl.value) < Number(maxControl.value) ? null : { minGreaterOrEqual: true };
    };
  }
}
