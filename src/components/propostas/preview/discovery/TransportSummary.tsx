'use client';

import type { TransporteData } from '@/lib/crm-types';
import { t, type IdiomaProposal } from '@/lib/i18n-proposta';

const TIPO_ICONS: Record<string, string> = {
  VOO: '✈️', TRANSFER: '🚐', TREM: '🚆', ONIBUS: '🚌', CARRO: '🚗', BARCO: '⛴️',
};

interface Props {
  transportes: TransporteData[];
  idioma: IdiomaProposal;
  corPrimaria: string;
}

function formatDate(d: string, idioma: IdiomaProposal): string {
  if (!d) return '—';
  const locale = idioma === 'en' ? 'en-US' : idioma === 'es' ? 'es-ES' : 'pt-BR';
  return new Date(d + 'T12:00:00').toLocaleDateString(locale, { day: '2-digit', month: 'short' });
}

export function TransportSummary({ transportes, idioma, corPrimaria }: Props) {
  const i18n = t(idioma);

  if (transportes.length === 0) return null;

  const voos = transportes.filter(t => t.tipo === 'VOO');
  const outros = transportes.filter(t => t.tipo !== 'VOO');

  return (
    <section id="discovery-transport" className="py-16 bg-white">
      <div className="max-w-5xl mx-auto px-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-8">{i18n.resumoTransportes}</h2>

        {/* Flights table */}
        {voos.length > 0 && (
          <div className="mb-10">
            <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
              ✈️ {i18n.voos}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2" style={{ borderColor: corPrimaria }}>
                    <th className="text-left py-3 px-3 font-semibold text-gray-700">Data</th>
                    <th className="text-left py-3 px-3 font-semibold text-gray-700">Voo</th>
                    <th className="text-left py-3 px-3 font-semibold text-gray-700">{i18n.embarque}</th>
                    <th className="text-left py-3 px-3 font-semibold text-gray-700">{i18n.desembarque}</th>
                  </tr>
                </thead>
                <tbody>
                  {voos.map((v, i) => (
                    <tr key={v.id || i} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="py-3 px-3 text-gray-600">{formatDate(v.data, idioma)}</td>
                      <td className="py-3 px-3">
                        <span className="font-medium text-gray-900">{v.companhia}</span>
                        {v.numero_voo && <span className="text-gray-500 ml-1">{v.numero_voo}</span>}
                      </td>
                      <td className="py-3 px-3 text-gray-600">
                        {v.origem}{v.horario_saida ? ` ${v.horario_saida}` : ''}
                      </td>
                      <td className="py-3 px-3 text-gray-600">
                        {v.destino}{v.horario_chegada ? ` ${v.horario_chegada}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Other transports table */}
        {outros.length > 0 && (
          <div>
            <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
              🚐 {i18n.transfers}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2" style={{ borderColor: corPrimaria }}>
                    <th className="text-left py-3 px-3 font-semibold text-gray-700">Data</th>
                    <th className="text-left py-3 px-3 font-semibold text-gray-700">Tipo</th>
                    <th className="text-left py-3 px-3 font-semibold text-gray-700">{i18n.embarque}</th>
                    <th className="text-left py-3 px-3 font-semibold text-gray-700">{i18n.desembarque}</th>
                    <th className="text-left py-3 px-3 font-semibold text-gray-700">{i18n.distancia}</th>
                    <th className="text-left py-3 px-3 font-semibold text-gray-700">{i18n.tempoEstimado}</th>
                  </tr>
                </thead>
                <tbody>
                  {outros.map((tr, i) => (
                    <tr key={tr.id || i} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="py-3 px-3 text-gray-600">{formatDate(tr.data, idioma)}</td>
                      <td className="py-3 px-3">
                        <span className="mr-1">{TIPO_ICONS[tr.tipo] || '🚐'}</span>
                        <span className="text-gray-700">{tr.tipo}</span>
                      </td>
                      <td className="py-3 px-3 text-gray-600">
                        {tr.origem}{tr.horario_saida ? ` ${tr.horario_saida}` : ''}
                      </td>
                      <td className="py-3 px-3 text-gray-600">
                        {tr.destino}{tr.horario_chegada ? ` ${tr.horario_chegada}` : ''}
                      </td>
                      <td className="py-3 px-3 text-gray-600">
                        {tr.distancia_km ? `${tr.distancia_km} km` : '—'}
                      </td>
                      <td className="py-3 px-3 text-gray-600">
                        {tr.tempo_estimado || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
