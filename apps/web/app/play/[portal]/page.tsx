'use client';

import { notFound, useParams } from 'next/navigation';
import { PortalBoot, isPortalId } from '@/components/portal/PortalBoot';
import { PortalHome } from '@/components/portal/PortalHome';
import { PortalJoinListener } from '@/components/portal/PortalJoinListener';

// A game portal's front page: /play/crazygames. Framed by the portal (see next.config.ts).
export default function PortalPage() {
  const { portal } = useParams<{ portal: string }>();
  if (!isPortalId(portal)) notFound();
  return (
    <PortalBoot portal={portal}>
      <PortalJoinListener />
      <PortalHome />
    </PortalBoot>
  );
}
