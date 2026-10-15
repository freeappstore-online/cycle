import type { Flow, MoodId, SymptomId } from './data/types'

export const FLOW_LABELS: Record<Flow, string> = {
  spotting: 'Spotting',
  light: 'Light',
  medium: 'Medium',
  heavy: 'Heavy',
}

export const SYMPTOM_LABELS: Record<SymptomId, string> = {
  cramps: 'Cramps',
  headache: 'Headache',
  bloating: 'Bloating',
  acne: 'Acne',
  tender_breasts: 'Tender breasts',
  fatigue: 'Fatigue',
  nausea: 'Nausea',
  back_pain: 'Back pain',
  cravings: 'Cravings',
  insomnia: 'Insomnia',
  diarrhea: 'Diarrhoea',
  constipation: 'Constipation',
  dizziness: 'Dizziness',
  discharge: 'Discharge',
}

export const MOOD_LABELS: Record<MoodId, string> = {
  happy: 'Happy',
  calm: 'Calm',
  sad: 'Sad',
  anxious: 'Anxious',
  irritable: 'Irritable',
  sensitive: 'Sensitive',
  energetic: 'Energetic',
  low_energy: 'Low energy',
}
