'use client';

import { useParams } from 'next/navigation';
import { MapaMentalEditor } from './MapaMentalEditor';

export default function Page() {
  const params = useParams();
  const id = params?.id as string;
  if (!id) return null;
  return <MapaMentalEditor id={id} />;
}
