import { AppPageContainer } from '../components/common'
import { HomeWorkbench } from '../features/home/HomeWorkbench'
import './HomePage.scss'

function HomePage() {
  // 首页直接复用统一详情容器的 fixed body，不注册顶部标题或说明；三区工作台由容器
  // 提供完整可用高度，页面自身不再创建 max-width、hero 或纵向滚动 shell。
  return <AppPageContainer className="home-page" scrollable={false}><HomeWorkbench /></AppPageContainer>
}

export default HomePage
