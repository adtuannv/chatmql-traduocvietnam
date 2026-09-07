import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/components/shared/page-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PropertiesTab } from './properties-tab'
import { SegmentsTab } from './segments-tab'
import { PresetsTab } from './presets-tab'
import { EventsTab } from './events-tab'
import { LifecycleTab } from './lifecycle-tab'

const TABS = [
  { value: 'properties', label: 'Thuộc tính' },
  { value: 'segments', label: 'Segment' },
  { value: 'presets', label: 'Preset' },
  { value: 'events', label: 'Sự kiện' },
  { value: 'lifecycle', label: 'Vòng đời' },
] as const
type TabValue = (typeof TABS)[number]['value']

function isTab(v: string | null): v is TabValue {
  return TABS.some((t) => t.value === v)
}

/**
 * Trang CDP — thuộc tính tuỳ chỉnh, segment, preset ngành, từ điển & dòng sự kiện, phễu vòng đời.
 * Tab hiện tại đồng bộ qua `?tab=` để chia sẻ được link.
 */
export function CdpPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const raw = searchParams.get('tab')
  const tab: TabValue = isTab(raw) ? raw : 'properties'

  return (
    <div className="space-y-6">
      <PageHeader title="CDP" description="Nền tảng dữ liệu khách hàng: thuộc tính, phân khúc, sự kiện và vòng đời." />

      <Tabs
        value={tab}
        onValueChange={(v) =>
          setSearchParams(v === 'properties' ? {} : { tab: v }, {
            replace: true,
          })
        }
      >
        <div className="w-full overflow-x-auto">
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {/* Nội dung tab chỉ mount khi active để không gọi API của cả 5 tab cùng lúc */}
        <TabsContent value="properties">{tab === 'properties' && <PropertiesTab />}</TabsContent>
        <TabsContent value="segments">{tab === 'segments' && <SegmentsTab />}</TabsContent>
        <TabsContent value="presets">{tab === 'presets' && <PresetsTab />}</TabsContent>
        <TabsContent value="events">{tab === 'events' && <EventsTab />}</TabsContent>
        <TabsContent value="lifecycle">{tab === 'lifecycle' && <LifecycleTab />}</TabsContent>
      </Tabs>
    </div>
  )
}
