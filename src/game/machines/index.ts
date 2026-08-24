import type { Machine } from '../machine.js';
import { MOLTEN_CORE } from './molten.js';
import { ORBIT_CADET } from './orbit.js';
import { TIDEWRECK } from './tide.js';

/**
 * Every machine, in the order the picker walks them.
 *
 * The first is the default for a browser that has never chosen one.
 */
export const MACHINES: readonly Machine[] = [ORBIT_CADET, MOLTEN_CORE, TIDEWRECK];

export const DEFAULT_MACHINE: Machine = ORBIT_CADET;

/** The machine with this id, or the default if the id is unknown. */
export function machineById(id: string | null | undefined): Machine {
  return MACHINES.find((m) => m.id === id) ?? DEFAULT_MACHINE;
}
