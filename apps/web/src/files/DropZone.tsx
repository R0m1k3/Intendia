import { Upload } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { cx } from '../components/ui';

/** Accepts files dropped anywhere on its area; shows where they will go. */
export function DropZone({ onFiles, label, children, className }: {
  onFiles: (files: File[]) => void; label: string; children: ReactNode; className?: string;
}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');
  return (
    <div
      className={cx('relative', className)}
      onDragEnter={(e) => { if (!hasFiles(e)) return; e.preventDefault(); depth.current += 1; setOver(true); }}
      onDragOver={(e) => { if (hasFiles(e)) e.preventDefault(); }}
      onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) onFiles(files);
      }}
    >
      {children}
      {over && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-paper/85">
          <p className="flex items-center gap-2 text-sm font-medium text-accent">
            <Upload className="size-4" strokeWidth={1.5} />{label}
          </p>
        </div>
      )}
    </div>
  );
}
