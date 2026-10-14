'use client';

import { notFound, useParams } from 'next/navigation';
import { RoomScreen } from '@/components/RoomScreen';
import { PortalBoot, isPortalId } from '@/components/portal/PortalBoot';
import { PortalJoinListener } from '@/components/portal/PortalJoinListener';

// A room on a game portal: /play/crazygames/r/CODE (the website's is /r/CODE).
export default function PortalRoomPage() {
  const { portal, code } = useParams<{ portal: string; code: string }>();
  if (!isPortalId(portal)) notFound();
  return (
    <PortalBoot portal={portal}>
      <PortalJoinListener />
      <RoomScreen code={(code ?? '').toUpperCase()} />
    </PortalBoot>
  );
}
