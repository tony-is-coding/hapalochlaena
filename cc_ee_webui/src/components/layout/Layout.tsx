import { Layout as AntLayout, Button, Space, Typography } from 'antd'
import { ReactNode } from 'react'
import { useAuth } from '../../hooks/useAuth'

const { Header, Content } = AntLayout
const { Text } = Typography

interface LayoutProps {
  children: ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const { user, logout } = useAuth()

  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px' }}>
        <Text style={{ color: 'white', fontSize: '18px', fontWeight: 600 }}>
          cc_ee Enterprise
        </Text>
        {user && (
          <Space>
            <Text style={{ color: 'rgba(255,255,255,0.85)' }}>{user.email}</Text>
            <Button size="small" onClick={logout}>Logout</Button>
          </Space>
        )}
      </Header>
      <Content style={{ padding: '24px' }}>{children}</Content>
    </AntLayout>
  )
}
