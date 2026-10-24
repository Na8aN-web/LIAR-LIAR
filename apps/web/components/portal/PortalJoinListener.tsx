'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { portal, roomHref } from '@/lib/portal';
import { getSocket } from '@/lib/socket';
import { useGame } from '@/lib/store';

/**
 * A friend's invite accepted while the game is already open (the portal's invite notification,
 * friends list or invite link): leave the current room and go to theirs, without a reload.
 */
export function PortalJoinListener() {
  const router = useRouter();
  const toast = useGame((s) => s.showToast);
  useEffect(
    () =>
      portal().onJoinRoom((code) => {
        if (!code) return toast("That invite doesn't name a room to join.");
        if (location.pathname.endsWith(`/r/${code}`)) return toast("You're already in that room.");
        getSocket().emit('room:leave');
        portal().updateRoom(null);
        router.push(roomHref(code));
      }),
    [router, toast],
  );
  return null;
}
