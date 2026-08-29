import React, { useCallback, useState } from 'react';
import { Upload } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface UploadZoneProps {
  onFileLoaded: (file: File) => void;
  isLoading: boolean;
}

const ACCEPTED_EXTENSIONS = ['.ics', '.pdf', '.txt', '.eml', '.msg', '.docx'];

const hasAcceptedExtension = (fileName: string) =>
  ACCEPTED_EXTENSIONS.some((ext) => fileName.toLowerCase().endsWith(ext));

export function UploadZone({ onFileLoaded, isLoading }: UploadZoneProps) {
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const acceptFile = useCallback(
    (file: File | undefined | null) => {
      if (!file) return;

      if (!hasAcceptedExtension(file.name)) {
        toast.error('That file type is not supported. Use a PDF, Word, email, text, or ICS file.');
        return;
      }

      onFileLoaded(file);
    },
    [onFileLoaded]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      acceptFile(e.target.files?.[0]);
    },
    [acceptFile]
  );

  // dragover must be cancelled on every tick or the browser reverts to its
  // default behaviour and opens the dropped file instead of handing it over.
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (isLoading) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDraggingOver(true);
  }, [isLoading]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Ignore the leave events fired while crossing this element's own children.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setIsDraggingOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDraggingOver(false);
      if (isLoading) return;
      acceptFile(e.dataTransfer.files?.[0]);
    },
    [acceptFile, isLoading]
  );

  const headline = isLoading
    ? 'Reading the document'
    : isDraggingOver
      ? 'Drop it here'
      : 'Drop an agenda file, or choose one';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2, duration: 0.4, ease: [0.2, 0.7, 0.3, 1] }}
    >
      <label
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'group block cursor-pointer border border-dashed bg-card px-5 py-6 transition-colors duration-200 focus-within:border-primary md:px-7 md:py-7',
          isDraggingOver ? 'border-primary bg-secondary' : 'border-border hover:border-primary/70'
        )}
      >
        <span className="eyebrow mb-3 block">Start here</span>

        <span className="flex items-start gap-4">
          <span
            className={cn(
              'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center border bg-background transition-colors duration-200',
              isDraggingOver ? 'border-primary' : 'border-border group-hover:border-primary'
            )}
          >
            {isLoading ? (
              <span className="block h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
          </span>

          <span className="min-w-0">
            <span className="block text-lg font-bold leading-tight tracking-tight md:text-2xl">
              {headline}
            </span>
            <span className="mt-1.5 block text-sm leading-relaxed text-muted-foreground">
              {isLoading
                ? 'Extracting text, then reading it section by section.'
                : 'An .ics is parsed on this device. Everything else is read by AI.'}
            </span>
          </span>
        </span>

        <span className="mt-5 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-border pt-3.5">
          {ACCEPTED_EXTENSIONS.map((ext) => (
            <span key={ext} className="eyebrow">{ext}</span>
          ))}
        </span>

        <input
          type="file"
          accept={ACCEPTED_EXTENSIONS.join(',')}
          className="sr-only"
          onChange={handleFileChange}
          disabled={isLoading}
        />
      </label>
    </motion.div>
  );
}
