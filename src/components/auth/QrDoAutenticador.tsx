'use client';

/**
 * QR code do cadastro do aplicativo autenticador (12/11/2026). A pessoa
 * aponta a câmera do aplicativo e pronto, sem digitar a chave de 32 letras.
 * O desenho é feito aqui no navegador: a chave não sai para nenhum serviço.
 */
import { useEffect, useState } from 'react';

export function QrDoAutenticador({ uri, tamanho = 192 }: { uri: string; tamanho?: number }) {
  // Guarda de qual chave é a imagem: chave nova mostra "Gerando" até o QR
  // dela ficar pronto, sem nunca exibir o QR de outra chave.
  const [gerado, setGerado] = useState<{ uri: string; url: string } | null>(null);
  const imagem = gerado?.uri === uri ? gerado.url : null;

  useEffect(() => {
    let vivo = true;
    import('qrcode')
      .then(qr => qr.toDataURL(uri, { margin: 1, width: tamanho * 2, errorCorrectionLevel: 'M' }))
      .then(url => { if (vivo) setGerado({ uri, url }); })
      .catch(() => { /* sem QR a chave escrita continua na tela */ });
    return () => { vivo = false; };
  }, [uri, tamanho]);

  return (
    <div
      className="mx-auto flex items-center justify-center rounded-lg bg-white p-2"
      style={{ width: tamanho + 16, height: tamanho + 16 }}
    >
      {imagem
        ? <img src={imagem} alt="Código QR para o aplicativo autenticador" width={tamanho} height={tamanho} />
        : <span className="text-xs text-neutral-500">Gerando o QR…</span>}
    </div>
  );
}
