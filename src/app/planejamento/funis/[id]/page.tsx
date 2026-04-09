import { FunilEditor } from './FunilEditor';

export default async function FunilEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FunilEditor id={id} />;
}
