// Shared wording for the medical / accuracy disclaimer (#143), used in the app
// and in the doctor PDF so they can't drift apart.

export const DISCLAIMER =
  'Estimates only, not medical advice. Do not use this app for contraception. Talk to a clinician about irregular cycles or symptoms that concern you.'

export const LOCAL_PRIVACY =
  'With sync off, all data stored only on this device, never uploaded: this applies to your cycle logs and settings, not the page-view counts described below.'

export const STORAGE_WARNING =
  'Local data may be lost if you clear browser or device storage, or lose this device. Exporting a backup creates a file you control: you choose where to save or share it. A plain backup can be read by anyone who has the file.'

export const PREDICTION_METHOD =
  'A cycle runs from the first day of one period to the first day of the next. We average up to six recent completed cycles, leaving gaps shorter than 15 or longer than 90 days out of the average. Without a usable completed cycle, we use the cycle length from setup, or 28 days. Period duration uses up to six recent logged periods with end dates, or your setup length, or 5 days.'

export const FERTILE_EXPLANATION =
  'Ovulation means an egg is released. We estimate it by counting back from the estimated next period: 14 days by default, or your configured offset. The estimated fertile window runs from five days before ovulation to one day after it, widened across the whole estimated period-start range. It suggests when pregnancy might be more likely; it cannot confirm ovulation or identify safe days. Actual dates can fall outside these ranges, especially with limited or irregular history.'
