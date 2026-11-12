// Synthetic facts only. Never populate a shared business database with these rows.
export const liveResorts = [
  {
    key: 'pine',
    name: '合成松林雪场',
    price: 180,
    hours: '09:00–17:00',
    trails: '四条初级缓坡和儿童练习区，适合初学者与亲子家庭。',
    facilities: '提供头盔、雪板租赁和教练预约，没有夜场。',
    description: '位于合成北城，日票180元。亲子和新手可选择松林雪场。',
  },
  {
    key: 'cloud',
    name: '合成云峰雪场',
    price: 320,
    hours: '08:30–21:00',
    trails: '两条高级陡坡和一条中级雪道，适合有经验的滑雪者。',
    facilities: '提供夜场、缆车和雪具寄存，不设儿童练习区。',
    description: '位于合成南城，日票320元。夜滑和高级练习可选择云峰雪场。',
  },
] as const;

export const liveArticles = [
  {
    key: 'helmet',
    title: '合成滑雪知识：头盔与护具',
    body: '初学者每次滑雪都应佩戴合适的滑雪头盔。头盔应贴合头部并扣紧绑带；护目镜保护眼睛，护腕和护膝不能代替头盔。合成知识只供验收，实际安全指导应以教练和现场规则为准。',
  },
  {
    key: 'braking',
    title: '合成滑雪知识：初学减速与摔倒',
    body: '初学双板应先在缓坡学习犁式减速，双板板尖靠近、板尾分开，控制速度后再上更长雪道。摔倒后先确认上方来人，避免停留在坡道盲区。不要直接冲向高级陡坡。',
  },
  {
    key: 'clothing',
    title: '合成滑雪知识：保暖穿衣',
    body: '滑雪采用分层穿衣：内层排汗、中层保温、外层防风防水。棉质内衣湿后不易干，不适合作为贴身排汗层。手套、雪袜和护目镜也应提前准备。',
  },
  {
    key: 'altitude',
    title: '合成滑雪知识：身体不适与紧急求助',
    body: '在高海拔雪场出现明显头痛、眩晕或呼吸困难，应停止运动并联系现场救援，按专业人员安排下撤或就医。不可依赖AI诊断或强行继续滑雪。',
  },
] as const;

export const liveProjectDocuments = [
  {
    key: 'account',
    title: '合成平台账号与管理权限规则',
    content:
      '普通用户可以自助注册账号。管理端由已授权账号访问；系统管理员可以创建账号并绑定多个角色。商家是业务身份，账号依据角色权限管理自己归属的雪场；前端隐藏按钮不代替后端授权。',
  },
  {
    key: 'review',
    title: '合成雪场发布与审核规则',
    content:
      '商家提交雪场资料后由系统管理员审核发布。已经发布的雪场编辑后回到待审核状态，审核通过前从公开查询隐藏。草稿、下架和删除资料不能作为公开AI回答来源。',
  },
  {
    key: 'revenue',
    title: '合成平台收益统计规则',
    content:
      '收益由管理员录入和导入，商家只能查看本人归属雪场的收益。金额必须保留精度并按日期统计。公开AI问答不提供任何账号的私有收益金额，也不将整套业务库直接发送给模型。',
  },
  {
    key: 'ai',
    title: '合成平台AI问答与资料引用规则',
    content:
      'AI仅向已登录用户开放。回答依据允许检索的雪场、滑雪知识和项目公开资料，并返回可核对的来源引用。没有资料时应拒答，人工停用或撤回的资料不能继续作为回答证据。',
  },
] as const;

export const liveRetrievalQuestions = [
  { id: 'R01', question: '松林雪场日票多少元？', expected: ['pine'] },
  {
    id: 'R02',
    question: '带孩子学滑雪，哪个雪场有儿童练习区？',
    expected: ['pine'],
  },
  { id: 'R03', question: '松林雪场几点关门，有没有夜场？', expected: ['pine'] },
  {
    id: 'R04',
    question: '云峰雪场的开放时间和日票价格是多少？',
    expected: ['cloud'],
  },
  {
    id: 'R05',
    question: '想夜滑并练习高级陡坡应该选择哪里？',
    expected: ['cloud'],
  },
  {
    id: 'R06',
    question: '松林和云峰哪个更适合初学者？',
    expected: ['pine', 'cloud'],
  },
  {
    id: 'R07',
    question: '比较松林和云峰的日票与营业时间。',
    expected: ['pine', 'cloud'],
  },
  { id: 'R08', question: '第一次滑雪需要戴头盔吗？', expected: ['helmet'] },
  { id: 'R09', question: '护腕能代替头盔保护头部吗？', expected: ['helmet'] },
  {
    id: 'R10',
    question: '双板新手怎么通过犁式控制速度？',
    expected: ['braking'],
  },
  {
    id: 'R11',
    question: '在雪道摔倒后可以停在盲区休息吗？',
    expected: ['braking'],
  },
  {
    id: 'R12',
    question: '滑雪分层穿衣的内中外三层是什么？',
    expected: ['clothing'],
  },
  {
    id: 'R13',
    question: '滑雪时贴身穿棉质内衣适合排汗吗？',
    expected: ['clothing'],
  },
  {
    id: 'R14',
    question: '高海拔滑雪时头晕呼吸困难应该怎么办？',
    expected: ['altitude'],
  },
  {
    id: 'R15',
    question: '普通用户如何注册，谁能绑定管理角色？',
    expected: ['account'],
  },
  {
    id: 'R16',
    question: '商家修改已发布雪场后还会立即公开吗？',
    expected: ['review'],
  },
  {
    id: 'R17',
    question: '商家能否查看其他雪场账号的私有收益？',
    expected: ['revenue'],
  },
  { id: 'R18', question: 'AI找不到资料时应该怎样处理？', expected: ['ai'] },
  {
    id: 'R19',
    question: '谁能够使用平台AI，回答有没有资料引用？',
    expected: ['ai'],
  },
  {
    id: 'R20',
    question: '那个雪场几点结束营业？',
    previousQuestions: ['松林雪场有初级雪道吗？'],
    expected: ['pine'],
  },
] as const;
