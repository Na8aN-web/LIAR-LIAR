'use client';

import { useParams } from 'next/navigation';
import { RoomScreen } from '@/components/RoomScreen';

export default function RoomPage() {
  const params = useParams<{ code: string }>();
  return <RoomScreen code={(params.code ?? '').toUpperCase()} />;
}
