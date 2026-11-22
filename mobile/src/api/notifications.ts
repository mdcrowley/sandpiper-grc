// In-app notifications (E38-09): the web's own endpoints, so read state is shared with the web.
import type { ApiResponse } from '../../../packages/api-client/src/index.ts';
import { apiFetch } from './client';

export type NotificationsPage = ApiResponse<'/api/notifications', 'get'>;
export type NotificationRow = NotificationsPage['rows'][number];

export function notificationsPage(page: number, unreadOnly: boolean, pageSize = 20): Promise<NotificationsPage> {
  const q = `page=${page}&pageSize=${pageSize}${unreadOnly ? '&unread=true' : ''}`;
  return apiFetch<NotificationsPage>(`/api/notifications?${q}`);
}

export async function unreadCount(): Promise<number> {
  return (await apiFetch<{ unread: number }>('/api/notifications/unread-count')).unread;
}
