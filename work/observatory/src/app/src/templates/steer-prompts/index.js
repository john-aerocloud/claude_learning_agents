// UC-S014-3 — steer-prompt template registry: one static template per steer
// action type (keys = SteerMenu STEER_ACTIONS enum values). {{token}}s are
// filled by lib/promptBuilder.js at generate time; templates themselves are
// static strings — no logic, no I/O.
import raiseDefect from './raise-defect.js';
import rePrioritise from './re-prioritise.js';
import reSlice from './re-slice.js';
import customSteer from './custom-steer.js';

export const STEER_PROMPT_TEMPLATES = {
  'raise-defect': raiseDefect,
  're-prioritise': rePrioritise,
  're-slice': reSlice,
  custom: customSteer,
};
