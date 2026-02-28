import React, { useCallback } from 'react';
import { Upload, Calendar, FileText, CheckCircle2, FileJson, Mail } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';

interface UploadZoneProps {
  onFileLoaded: (file: File) => void;
  isLoading: boolean;
}

export function UploadZone({ onFileLoaded, isLoading }: UploadZoneProps) {
  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const allowedExtensions = ['.ics', '.pdf', '.txt', '.eml', '.msg', '.docx'];
      const hasAllowedExtension = allowedExtensions.some(ext => file.name.toLowerCase().endsWith(ext));

      if (!hasAllowedExtension) {
        toast.error('File type not supported. Please upload an ICS, PDF, or Text file.');
        return;
      }

      onFileLoaded(file);
    },
    [onFileLoaded]
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-xl mx-auto w-full"
    >
      <label className="relative group cursor-pointer block touch-none">
        <div className="absolute inset-0 bg-primary/5 rounded-2xl md:rounded-3xl -rotate-1 group-hover:rotate-0 transition-transform duration-300" />
        <div className="relative glass-card p-6 md:p-12 text-center rounded-2xl md:rounded-3xl border-2 border-dashed border-primary/20 group-hover:border-primary/50 transition-colors duration-300">
          <div className="w-12 h-12 md:w-16 md:h-16 bg-primary/10 rounded-xl md:rounded-2xl flex items-center justify-center mx-auto mb-4 md:mb-6 group-hover:scale-110 transition-transform duration-300">
            {isLoading ? (
              <div className="w-6 h-6 md:w-8 md:h-8 border-3 md:border-4 border-primary border-t-transparent rounded-full animate-spin" />
            ) : (
              <Upload className="w-6 h-6 md:w-8 md:h-8 text-primary" />
            )}
          </div>
          <h2 className="text-xl md:text-2xl font-bold mb-1 md:mb-2">Upload Schedule</h2>
          <p className="text-sm md:text-base text-muted-foreground mb-6 md:mb-8 max-w-xs mx-auto">
            PDFs, Emails, Text files, or ICS. We'll extract events automatically.
          </p>
          <div className="grid grid-cols-2 gap-3 md:gap-4 text-[10px] md:text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5 md:gap-2 justify-center bg-muted/30 py-2 rounded-lg">
              <FileText className="w-3.5 h-3.5 md:w-4 md:h-4 text-primary/60" />
              <span>PDF / Docs</span>
            </div>
            <div className="flex items-center gap-1.5 md:gap-2 justify-center bg-muted/30 py-2 rounded-lg">
              <Mail className="w-3.5 h-3.5 md:w-4 md:h-4 text-primary/60" />
              <span>Email files</span>
            </div>
            <div className="flex items-center gap-1.5 md:gap-2 justify-center bg-muted/30 py-2 rounded-lg col-span-2">
              <FileJson className="w-3.5 h-3.5 md:w-4 md:h-4 text-primary/60" />
              <span>Standard ICS Calendar</span>
            </div>
          </div>
        </div>
        <input
          type="file"
          accept=".ics,.pdf,.txt,.eml,.msg,.docx"
          className="hidden"
          onChange={handleFileChange}
          disabled={isLoading}
        />
      </label>
    </motion.div>
  );
}
