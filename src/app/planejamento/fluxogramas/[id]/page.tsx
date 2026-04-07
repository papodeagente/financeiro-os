import FluxogramaEditor from './FluxogramaEditor';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FluxogramaEditor id={id} />;
}
