// ============================================================================
// RichTextEditor — editor WYSIWYG leve baseado em Tiptap.
// Barra de ferramentas: H2, H3, negrito, itálico, lista, link, limpar.
// Emite HTML via onChange.
// ============================================================================
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { useEffect } from "react";
import { Bold, Italic, Heading2, Heading3, List, ListOrdered, Link2, Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  value: string;
  onChange: (html: string) => void;
};

export function RichTextEditor({ value, onChange }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, HTMLAttributes: { rel: "noopener noreferrer" } }),
    ],
    content: value || "",
    editorProps: {
      attributes: {
        class:
          "prose prose-sm dark:prose-invert max-w-none min-h-[420px] rounded-md border border-input bg-background px-4 py-3 focus:outline-none focus:ring-2 focus:ring-ring",
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  // Sincroniza quando o valor externo muda (ex.: reset, switch entre abas).
  useEffect(() => {
    if (!editor) return;
    if (value !== editor.getHTML()) editor.commands.setContent(value || "", { emitUpdate: false });
  }, [value, editor]);

  if (!editor) return null;

  const promptLink = () => {
    const url = window.prompt("URL do link:", "https://");
    if (!url) return;
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  const btn = (active: boolean) =>
    `h-8 w-8 p-0 ${active ? "bg-accent text-accent-foreground" : ""}`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1 rounded-md border border-input bg-muted/40 p-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={btn(editor.isActive("heading", { level: 2 }))}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          title="Título H2"
        >
          <Heading2 className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={btn(editor.isActive("heading", { level: 3 }))}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          title="Título H3"
        >
          <Heading3 className="h-4 w-4" />
        </Button>
        <span className="mx-1 h-5 w-px bg-border" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={btn(editor.isActive("bold"))}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="Negrito"
        >
          <Bold className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={btn(editor.isActive("italic"))}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="Itálico"
        >
          <Italic className="h-4 w-4" />
        </Button>
        <span className="mx-1 h-5 w-px bg-border" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={btn(editor.isActive("bulletList"))}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          title="Lista"
        >
          <List className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={btn(editor.isActive("orderedList"))}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          title="Lista numerada"
        >
          <ListOrdered className="h-4 w-4" />
        </Button>
        <span className="mx-1 h-5 w-px bg-border" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={btn(editor.isActive("link"))}
          onClick={promptLink}
          title="Link"
        >
          <Link2 className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
          title="Limpar formatação"
        >
          <Eraser className="h-4 w-4" />
        </Button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
