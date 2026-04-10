declare module 'html2pdf.js' {
  interface Html2PdfOptions {
    margin?: number | [number, number, number, number];
    filename?: string;
    image?: { type?: string; quality?: number };
    html2canvas?: Record<string, unknown>;
    jsPDF?: { unit?: string; format?: string; orientation?: string };
    pagebreak?: { mode?: string[]; avoid?: string[] };
  }
  interface Html2Pdf {
    set(options: Html2PdfOptions): Html2Pdf;
    from(element: HTMLElement): Html2Pdf;
    save(): Promise<void>;
    outputPdf(type?: 'blob' | 'datauristring'): Promise<Blob | string>;
  }
  function html2pdf(): Html2Pdf;
  export default html2pdf;
}
