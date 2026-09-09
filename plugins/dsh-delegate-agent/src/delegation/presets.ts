export const MAX_PRESET_NAME_LENGTH = 100
export const MAX_FIXED_INSTRUCTIONS_LENGTH = 100_000
export const MAX_COMPOSED_PROMPT_LENGTH = 200_000

export function composePrompt(fixedInstructions: string, taskInstruction: string): string {
  const fixed = fixedInstructions.trim()
  const task = taskInstruction.trim()
  if (task === '') throw new Error('task instruction must not be empty')
  if (fixed === '') return task
  const marker = '{{task}}'
  return fixed.includes(marker)
    ? fixed.replace(marker, () => task)
    : `${fixed}\n\nTask:\n${task}`
}
