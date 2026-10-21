'use client';

import { Alert, Button, Form, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { IntroductionQuerySchema, IntroductionResultSchema } from '@sab/shared';
import { ErrorAlert } from '@/components/data/error-alert';
import { ResultBlock } from '@/components/ui/result-block';
import { MemberSelect } from '@/components/forms/member-select';
import { buildRequest } from '@/lib/tools/build-request';
import { getTool } from '@/lib/tools/tool-api';
import { useToolRun } from '@/lib/tools/use-tool-run';
import { useRequiredRule } from '../shared/fields';
import { TextBlock } from '../shared/text-block';
import { ToolCard } from '../shared/tool-card';

interface Values {
  userId: string;
}

/** Finds the first introduction a member wrote in the server's intro channel. */
export function IntroductionForm({ guildId }: { guildId: string }) {
  const t = useTranslations('web-tools');
  const required = useRequiredRule();
  const [form] = Form.useForm<Values>();
  const action = useToolRun((query: { userId: string }) =>
    getTool(guildId, 'info/introduction', query, IntroductionResultSchema),
  );
  const result = action.result;

  return (
    <ToolCard title={t('info.introduction.title')} description={t('info.introduction.description')}>
      <Form
        form={form}
        layout="vertical"
        onFinish={(values) => void action.submit(buildRequest(IntroductionQuerySchema, values))}
        onValuesChange={action.clear}
      >
        <Form.Item name="userId" label={t('info.memberLabel')} rules={[required]}>
          <MemberSelect guildId={guildId} />
        </Form.Item>
        <Form.Item style={{ marginBottom: 0 }}>
          <Button type="primary" htmlType="submit" loading={action.pending}>
            {t('info.introduction.submit')}
          </Button>
        </Form.Item>
      </Form>
      {action.error === undefined ? null : (
        <ResultBlock>
          <ErrorAlert
            error={action.error}
            onRetry={() => void action.retry()}
            retrying={action.pending}
          />
        </ResultBlock>
      )}
      {result === undefined ? null : (
        <ResultBlock>
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            {result.status === 'NO_CHANNEL' ? (
              <Alert type="info" showIcon title={t('info.introduction.noChannel')} />
            ) : null}
            {result.status === 'NOT_FOUND' ? (
              <Alert
                type="info"
                showIcon
                title={t('info.introduction.notFound', { count: result.scanned })}
              />
            ) : null}
            {result.status === 'FOUND' ? (
              <>
                <Typography.Text strong>{t('info.introduction.found')}</Typography.Text>
                <TextBlock
                  text={result.content === '' ? t('common.none') : result.content}
                  copyText={result.content}
                  copyLabel={t('info.introduction.copyText')}
                />
                <Typography.Text strong>{t('info.introduction.link')}</Typography.Text>
                <TextBlock text={result.url} copyLabel={t('info.introduction.copyLink')} />
              </>
            ) : null}
          </div>
        </ResultBlock>
      )}
    </ToolCard>
  );
}
