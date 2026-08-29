import React, { useCallback } from 'react';
import { Upload } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';

interface UploadZoneProps {
  onFileLoaded: (file: File) => void;
  isLoading: boolean;
}

const ACCEPTED_EXTENSIONS = ['.ics', '.pdf', '.txt', '.eml', '.msg', '.docx'];

export function UploadZone({ onFileLoaded, isLoading }: UploadZoneProps) {
  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const hasAllowedExtension = ACCEPTED_EXTENSIONS.some(ext => file.name.toLowerCase().endsWith(ext));

      if (!hasAllowedExtension) {
        toast.error('That file type is not supported. Use a PDF, Word, email, text, or ICS file.');
        return;
      }

      onFileLoaded(file);
    },
    [onFileLoaded]
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2, duration: 0.4, ease: [0.2, 0.7, 0.3, 1] }}
    >
      <label className="group block cursor-pointer border border-dashed border-border bg-card px-5 py-6 transition-colors duration-200 hover:border-primary/70 focus-within:border-primary md:px-7 md:py-7">
        <span className="eyebrow mb-3 block">Start here</span>

        <span className="flex items-start gap-4">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center border border-border bg-background transition-colors duration-200 group-hover:border-primary">
            {isLoading ? (
              <span className="block h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
          </span>

          <span className="min-w-0">
            <span className="block text-lg font-bold leading-tight tracking-tight md:text-2xl">
              {isLoading ? 'Reading the document' : 'Choose an agenda file'}
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
