/** Generic multi-select helpers for checkbox project lists. */

export function toggleProjectSelection(selected: readonly string[], projectId: string): string[] {
  if (selected.includes(projectId)) return selected.filter((id) => id !== projectId)
  return [...selected, projectId]
}

export function selectAllProjectIds(projectIds: readonly string[]): string[] {
  return [...projectIds]
}

export function deselectAllProjectIds(): string[] {
  return []
}

export type SelectAllCheckboxState = 'checked' | 'unchecked' | 'indeterminate'

export function selectAllCheckboxState(
  selectedCount: number,
  totalCount: number,
): SelectAllCheckboxState {
  if (totalCount <= 0 || selectedCount <= 0) return 'unchecked'
  if (selectedCount >= totalCount) return 'checked'
  return 'indeterminate'
}
