import type { Agent, Day, Shift } from './types';
import { DAYS } from './types';

/** Rule violations for placing `agent` on (queue, shift, dayOff). Empty array = legal. */
export function validateEdit(agent: Agent, queue: string, shiftIdx: number, dayOff: Day, shifts: Shift[]): string[] {
  const v: string[] = [];
  if (!agent.queues.includes(queue)) v.push(`${queue} is not in this agent's skills (${agent.queues.join(', ')})`);
  if (shifts[shiftIdx]?.evening && !agent.eveningOk) v.push('agent cannot work evening shifts');
  if (!DAYS.includes(dayOff)) v.push(`unknown day off ${dayOff}`);
  else {
    if (!agent.availableSunday && dayOff !== 'Sunday') v.push('agent is unavailable on Sunday, so Sunday must be the day off');
    if (agent.fixedDayOff && dayOff !== agent.fixedDayOff) v.push(`agent has a fixed day off: ${agent.fixedDayOff}`);
  }
  return v;
}
