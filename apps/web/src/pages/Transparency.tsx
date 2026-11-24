// v0.5 K-28 / panel E K6 "Sistem neyi ölçer / ölçmez" — the same page for every user, plain Turkish.
import { PageHeader } from '../components/AppShell';
import { Card } from '../components/ui';

const MEASURES = [
  'İş kayıtları: talep, teklif, sözleşme, ödeme, karar — kim yaptı, ne zaman (denetim izi; silinmez)',
  'Teklif süresi iş saatiyle; müşteri bekleme süresi ve yönetici karar bekleme süresi ayrı tutulur',
  'Teklif kalitesi (düzeltilen / onaya giden teklif) hazırlayana ve ekibine; AI taslak düzeltmeleri kişi değil AI kalite ölçüsüdür',
  'Tedarikçiye söz tutma yalnız acenta ve proje düzeyinde',
  'Saha konumu yalnız görev check-in anında ve gönüllü',
];
const NEVER = [
  'Ekran, tuş vuruşu, aktif dakika, "çevrim içi" süresi',
  'Mesai dışı çevrim içi durum veya sürekli konum',
  'Kişisel WhatsApp, kişisel e-posta veya kişisel cihaz içeriği (yalnız sizin "Projeye ilet" dedikleriniz)',
  'Ayrılma riski, sadakat, ruh hali veya kişilik skoru — yapay zekâ çalışan hakkında çıkarım yapamaz',
  'İsimli ekip sıralaması çalışanlara gösterilmez; yalnız yönetici görür',
];

export function TransparencyPage() {
  return (
    <div className="page mobile-page">
      <PageHeader title="Sistem neyi ölçer, neyi ölçmez?" />
      <div className="stack stack--lg">
        <Card title="Ölçer"><ul>{MEASURES.map((x) => <li key={x}>{x}</li>)}</ul></Card>
        <Card title="Asla ölçmez"><ul>{NEVER.map((x) => <li key={x}>{x}</li>)}</ul></Card>
        <Card title="Rakamlar nasıl kullanılır?">
          <p>Performans rakamları insan değerlendirmesinin girdisidir; otomatik yaptırım dayanağı değildir. Kendi rakamlarınızı "Benim panom"da görürsünüz; itiraz ve açıklama notunuzu yöneticinize iletebilirsiniz.</p>
          <p className="muted small">Çalışan aydınlatma metni acentanız tarafından sağlanır [Doğrulanmalı: avukat].</p>
        </Card>
      </div>
    </div>
  );
}
