'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { portal, roomHref } from '@/lib/portal';
import { getSocket } from '@/lib/socket';

/**
 * A friend's invite accepted while the game is already open (the portal's invite notification,
 * friends list or invite link): leave the current room and go to theirs, without a reload.
 */
export function PortalJoinListener() {
  const router = useRouter();
  useEffect(
    () =>
      portal().onJoinRoom((code) => {
        if (location.pathname.endsWith(`/r/${code}`)) return;
        getSocket().emit('room:leave');
        portal().updateRoom(null);
        router.push(roomHref(code));
      }),
    [router],
  );
  return null;
}
