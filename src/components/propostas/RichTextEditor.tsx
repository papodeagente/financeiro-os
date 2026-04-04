'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Highlight from '@tiptap/extension-highlight';
import Placeholder from '@tiptap/extension-placeholder';
import { useEffect, useRef } from 'react';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  AlignLeft, AlignCenter, AlignRight,
  List, ListOrdered, Quote, Link as LinkIcon,
  Highlighter, Undo, Redo, Minus,
} from 'lucide-react';

interface Props {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

function ToolbarButton({
  onClick, active, disabled, children, title,
}: {
  onClick: () => void; active?: boolean; disabled?: boolean; children: React.ReactNode; title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded transition-colors ${
        active
          ? 'bg-[var(--t-green)]/20 text-[var(--t-green)]'
          : 'text-[var(--t-text-muted)] hover:text-[var(--t-text)] hover:bg-[var(--t-surface-hover)]'
      } disabled:opacity-30`}
    >
      {children}
    </button>
  );
}

export function RichTextEditor({ content, onChange, placeholder }: Props) {
  const isInternalUpdate = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
      }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Underline,
      Link.configure({ openOnClick: false, HTMLAttributes: { class: 'text-[var(--t-green)] underline' } }),
      Highlight.configure({ multicolor: false }),
      Placeholder.configure({ placeholder: placeholder || 'Escreva aqui...' }),
    ],
    content: content || '',
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none min-h-[80px] px-3 py-2 text-[var(--t-text)]',
      },
    },
    onUpdate: ({ editor: ed }) => {
      isInternalUpdate.current = true;
      onChange(ed.getHTML());
    },
  });

  // Sync external content changes (e.g. from AI generation)
  useEffect(() => {
    if (!editor) return;
    if (isInternalUpdate.current) {
      isInternalUpdate.current = false;
      return;
    }
    const currentHTML = editor.getHTML();
    if (content !== currentHTML) {
      editor.commands.setContent(content || '', { emitUpdate: false });
    }
  }, [content, editor]);

  if (!editor) return null;

  const addLink = () => {
    const url = window.prompt('URL do link:');
    if (url) {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
  };

  const s = 3.5;

  return (
    <div className="shadow-[var(--t-card-shadow)] rounded-lg overflow-hidden bg-[var(--t-bg)]">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-[var(--t-border)] bg-[var(--t-surface)]">
        {/* Text formatting */}
        <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Negrito">
          <Bold className={`w-${s} h-${s}`} style={{ width: 14, height: 14 }} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italico">
          <Italic style={{ width: 14, height: 14 }} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Sublinhado">
          <UnderlineIcon style={{ width: 14, height: 14 }} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Riscado">
          <Strikethrough style={{ width: 14, height: 14 }} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleHighlight().run()} active={editor.isActive('highlight')} title="Destacar">
          <Highlighter style={{ width: 14, height: 14 }} />
        </ToolbarButton>

        <div className="w-px h-5 bg-[var(--t-border)] mx-1" />

        {/* Headings */}
        <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Titulo">
          <span className="text-[10px] font-bold" style={{ lineHeight: '14px' }}>H2</span>
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="Subtitulo">
          <span className="text-[10px] font-bold" style={{ lineHeight: '14px' }}>H3</span>
        </ToolbarButton>

        <div className="w-px h-5 bg-[var(--t-border)] mx-1" />

        {/* Alignment */}
        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="Alinhar esquerda">
          <AlignLeft style={{ width: 14, height: 14 }} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Centralizar">
          <AlignCenter style={{ width: 14, height: 14 }} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="Alinhar direita">
          <AlignRight style={{ width: 14, height: 14 }} />
        </ToolbarButton>

        <div className="w-px h-5 bg-[var(--t-border)] mx-1" />

        {/* Lists */}
        <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Lista">
          <List style={{ width: 14, height: 14 }} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Lista numerada">
          <ListOrdered style={{ width: 14, height: 14 }} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Citacao">
          <Quote style={{ width: 14, height: 14 }} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Linha horizontal">
          <Minus style={{ width: 14, height: 14 }} />
        </ToolbarButton>

        <div className="w-px h-5 bg-[var(--t-border)] mx-1" />

        {/* Link */}
        <ToolbarButton onClick={addLink} active={editor.isActive('link')} title="Link">
          <LinkIcon style={{ width: 14, height: 14 }} />
        </ToolbarButton>

        {/* Undo/Redo */}
        <div className="flex-1" />
        <ToolbarButton onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Desfazer">
          <Undo style={{ width: 14, height: 14 }} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Refazer">
          <Redo style={{ width: 14, height: 14 }} />
        </ToolbarButton>
      </div>

      {/* Editor */}
      <EditorContent editor={editor} />
    </div>
  );
}
