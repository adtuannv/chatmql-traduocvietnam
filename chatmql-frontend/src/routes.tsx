import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppLayout } from '@/layouts/app-layout'
import { ProtectedRoute } from '@/components/shared/guards'
import { LoginPage } from '@/pages/auth/login-page'
import { DashboardPage } from '@/pages/dashboard/dashboard-page'

// Hội thoại
import { ConversationsPage } from '@/pages/conversations/conversations-page'
// Khách hàng
import { CustomersPage } from '@/pages/customers/customers-page'
import { ContactDetailPage } from '@/pages/customers/contact-detail-page'
import { CompaniesPage } from '@/pages/customers/companies-page'
import { DuplicateContactsPage } from '@/pages/customers/duplicate-contacts-page'
import { PhoneExtractPage } from '@/pages/customers/phone-extract-page'
// CDP
import { CdpPage } from '@/pages/cdp/cdp-page'
// AI
import { AiWorkspacePage } from '@/pages/ai/ai-workspace-page'
import { AiScenariosPage } from '@/pages/ai/ai-scenarios-page'
import { TrainAiPage } from '@/pages/ai/train-ai-page'
// Lưu ý: AiTrainPage (train từng bot) khác TrainAiPage (soạn tài liệu logic của org).
import { AiTrainPage } from '@/pages/ai/ai-train-page'
import { KnowledgeGapsPage } from '@/pages/ai/knowledge-gaps-page'
import { AiImprovePage } from '@/pages/ai/ai-improve-page'
// Cài đặt
import { SettingsPage } from '@/pages/settings/settings-page'
import { ProfilePage } from '@/pages/settings/profile-page'
// Tự động hóa
import { AutomationPage } from '@/pages/automation/automation-page'
import { AutomationFlowPage } from '@/pages/automation/automation-flow-page'
// Sản phẩm & Tri thức
import { ProductsPage } from '@/pages/knowledge/products-page'
// Sản phẩm lấy thẳng từ CRM (chỉ đọc)
import { CrmProductsPage } from '@/pages/crm-products/crm-products-page'
// Tài liệu bán hàng (thư mục: biểu giá → danh mục → sản phẩm → chi tiết)
import { SalesDocsPage } from '@/pages/sales-docs/sales-docs-page'
import { DocLibraryPage } from '@/pages/sales-docs/doc-library-page'
// Tích hợp
import { IntegrationsPage } from '@/pages/integrations/integrations-page'
// Platform (super-admin) — auth & layout riêng
import { PlatformLayout } from '@/layouts/platform-layout'
import { PlatformLoginPage } from '@/pages/platform/platform-login-page'
import { PlatformDashboardPage } from '@/pages/platform/platform-dashboard-page'
import { OrgsPage } from '@/pages/platform/orgs-page'
import { OrgDetailPage } from '@/pages/platform/org-detail-page'
import { PlatformBrandingPage } from '@/pages/platform/platform-branding-page'

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },

  // Khu vực Platform super-admin (auth + layout riêng, guard nằm trong PlatformLayout)
  { path: '/platform/login', element: <PlatformLoginPage /> },
  {
    path: '/platform',
    element: <PlatformLayout />,
    children: [
      { index: true, element: <PlatformDashboardPage /> },
      { path: 'companies', element: <OrgsPage /> },
      { path: 'companies/:orgId', element: <OrgDetailPage /> },
      { path: 'branding', element: <PlatformBrandingPage /> },
    ],
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <DashboardPage /> },

      { path: 'conversations', element: <ProtectedRoute permission={'conversations.view'}><ConversationsPage /></ProtectedRoute> },
      { path: 'conversations/:id', element: <ProtectedRoute permission={'conversations.view'}><ConversationsPage /></ProtectedRoute> },

      { path: 'customers', element: <ProtectedRoute permission={'contacts.view'}><CustomersPage /></ProtectedRoute> },
      { path: 'customers/companies', element: <ProtectedRoute permission={'companies.view'}><CompaniesPage /></ProtectedRoute> },
      { path: 'customers/duplicates', element: <ProtectedRoute permission={'contacts.view'}><DuplicateContactsPage /></ProtectedRoute> },
      { path: 'customers/extract-phones', element: <ProtectedRoute permission={'contacts.view'}><PhoneExtractPage /></ProtectedRoute> },
      { path: 'customers/:id', element: <ProtectedRoute permission={'contacts.view'}><ContactDetailPage /></ProtectedRoute> },

      { path: 'cdp', element: <ProtectedRoute permission={'cdp.view'} roles={['owner', 'admin', 'manager']}><CdpPage /></ProtectedRoute> },

      { path: 'automation', element: <ProtectedRoute permission={'automation.view'} roles={['owner', 'admin', 'manager']}><AutomationPage /></ProtectedRoute> },
      { path: 'automation/flow/:ruleId', element: <ProtectedRoute permission={'automation.view'} roles={['owner', 'admin', 'manager']}><AutomationFlowPage /></ProtectedRoute> },

      { path: 'knowledge-base', element: <ProtectedRoute permission={'products.view'}><ProductsPage /></ProtectedRoute> },

      { path: 'crm-products', element: <ProtectedRoute permission={'products.view'}><CrmProductsPage /></ProtectedRoute> },

      { path: 'sales-docs', element: <ProtectedRoute permission={'products.view'}><SalesDocsPage /></ProtectedRoute> },
      { path: 'sales-docs/library', element: <ProtectedRoute permission={'products.view'}><DocLibraryPage /></ProtectedRoute> },
      { path: 'sales-docs/c/:catId', element: <ProtectedRoute permission={'products.view'}><SalesDocsPage /></ProtectedRoute> },
      { path: 'sales-docs/p/:productId', element: <ProtectedRoute permission={'products.view'}><SalesDocsPage /></ProtectedRoute> },

      { path: 'ai', element: <ProtectedRoute permission={'ai.view'}><AiWorkspacePage /></ProtectedRoute> },
      { path: 'ai/logic-docs', element: <ProtectedRoute permission={'ai.view'}><TrainAiPage /></ProtectedRoute> },
      { path: 'ai/train/:botId', element: <ProtectedRoute permission={'ai.view'}><AiTrainPage /></ProtectedRoute> },
      { path: 'ai/scenarios', element: <ProtectedRoute permission={'ai.view'}><AiScenariosPage /></ProtectedRoute> },
      { path: 'ai/knowledge-gaps', element: <ProtectedRoute permission={'ai.view'}><KnowledgeGapsPage /></ProtectedRoute> },
      { path: 'ai/improve', element: <ProtectedRoute permission={'ai.view'} roles={['owner', 'admin']}><AiImprovePage /></ProtectedRoute> },

      { path: 'integrations', element: <ProtectedRoute permission={'integrations.view'}><IntegrationsPage /></ProtectedRoute> },

      { path: 'settings', element: <ProtectedRoute permission={'settings.view'}><SettingsPage /></ProtectedRoute> },
      { path: 'settings/profile', element: <ProfilePage /> },
    ],
  },
  { path: '*', element: <Navigate to="/dashboard" replace /> },
])
