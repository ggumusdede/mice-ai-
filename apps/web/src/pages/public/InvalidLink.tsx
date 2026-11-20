import { ApiClientError } from '../../api/client';
import { useT } from '../../i18n';
import { PublicLayout } from '../../components/PublicLayout';
import { EmptyState } from '../../components/ui';

export function InvalidLink({ error }: { error: unknown }) {
  const t = useT();
  const network = error instanceof ApiClientError && error.isNetwork;
  return (
    <PublicLayout title="">
      <EmptyState icon={network ? 'cloudOff' : 'link'} title={network ? t.common.networkError : t.publicPages.invalidLink} />
    </PublicLayout>
  );
}
