import { Spin } from 'antd';

export default function ServersLoading() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: 240 }}>
      <Spin size="large" />
    </div>
  );
}
