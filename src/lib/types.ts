export type ExerciseType =
  | 'weight_reps'
  | 'bodyweight_reps'
  | 'duration'
  | 'distance_duration'
  | 'assisted_bodyweight';

export interface Exercise {
  id: string;
  slug: string;
  name: string;
  exerciseType: ExerciseType;
  equipment: string;
  primaryMuscle: string;
  secondaryMuscles: string[];
  isStretch: boolean;
  frames: [
    { index: 1; path: string },
    { index: 2; path: string },
    { index: 3; path: string },
  ];
}

export interface SetsRep {
  id: string;
  setNumber: number;
  reps?: number;
  weight?: number;
  durationSec?: number;
  completed: boolean;
  completedAt?: string;
}

export interface WorkoutExercise {
  exercise: Exercise;
  slug: string;
  sets: SetsRep[];
}

export type TimerMode = 'work' | 'rest';

export interface WorkoutSession {
  name: string;
  notes: string;
  exercises: WorkoutExercise[];
  startedAt: string;
  completedAt?: string;
}

export type Screen = 'timer' | 'browse' | 'build' | 'history';

export type TimerTab = 'guided' | 'interval';
