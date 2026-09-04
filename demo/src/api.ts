export type User = { id: number; email: string; name: string }
export type Note = { id: number; title: string; content: string; category: string; createdAt: string; updatedAt: string }
export type NoteRevision = { id: number | string; title: string; content: string; createdAt: string; isCurrent?: boolean }

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null
    throw new Error(body?.message || `请求失败（${response.status}）`)
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}

const pendingGetRequests = new Map<string, Promise<unknown>>()

function getOnce<T>(path: string, token: string): Promise<T> {
  const key = `${path}:${token}`
  const pending = pendingGetRequests.get(key) as Promise<T> | undefined
  if (pending) return pending

  const next = request<T>(path, {}, token)
  pendingGetRequests.set(key, next)
  void next.finally(() => {
    if (pendingGetRequests.get(key) === next) pendingGetRequests.delete(key)
  }).catch(() => undefined)
  return next
}

export const api = {
  login: (email: string, password: string) => request<{ token: string; user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (input: { name: string; email: string; password: string }) => request<{ token: string; user: User }>('/api/auth/register', { method: 'POST', body: JSON.stringify(input) }),
  session: (token: string) => getOnce<{ user: User }>('/api/auth/session', token),
  logout: (token: string) => request<void>('/api/auth/logout', { method: 'POST' }, token),
  notes: (token: string) => getOnce<{ notes: Note[] }>('/api/notes', token),
  createNote: (token: string, input: { title: string; content: string }) => request<{ note: Note }>('/api/notes', { method: 'POST', body: JSON.stringify(input) }, token),
  updateNote: (token: string, id: number, input: { title: string; content: string }) => request<{ note: Note }>(`/api/notes/${id}`, { method: 'PUT', body: JSON.stringify(input) }, token),
  noteHistory: (token: string, id: number) => request<{ revisions: NoteRevision[] }>(`/api/notes/${id}/history`, {}, token),
}
