import type { MusicSpace } from '../types/music-space';

export const demoMusicSpaces: MusicSpace[] = [
  {
    id: 'forest-cabin-rain', title: '雨声 | 森林小屋', subtitle: '助眠音乐空间',
    atmosphereText: '雨声把房间慢慢放暗。', durationSeconds: 9000, audioUrl: '',
    coverImageUrl: '/static/images/zhiyin-forest-cabin.png', visualType: 'image', category: '睡前',
    tags: ['通用', '睡前', '深夜失眠', '入睡', '自然氛围'], isFeatured: true, isMemberOnly: false,
    recommendationWeight: 96, playCount: 12860, favoriteCount: 2140, completionRate: 0.72, updatedAt: '2026-06-01'
  },
  {
    id: 'homework-focus', title: '写作业 | 安静书桌', subtitle: '学生专注空间',
    atmosphereText: '把注意力放回这一页。', durationSeconds: 3600, audioUrl: '',
    coverImageUrl: '/static/images/zhiyin-night-cafe.png', visualType: 'image', category: '写作业',
    tags: ['学生', '学习', '写作业', '专注', '轻音乐'], isFeatured: true, isMemberOnly: false,
    recommendationWeight: 98, playCount: 18630, favoriteCount: 3200, completionRate: 0.81, updatedAt: '2026-06-06'
  },
  {
    id: 'self-study-library', title: '晚自习 | 专注书桌', subtitle: '长时间自习空间',
    atmosphereText: '保持稳定，不急着完成所有事。', durationSeconds: 7200, audioUrl: '',
    coverImageUrl: '/static/images/zhiyin-night-cafe.png', visualType: 'image', category: '晚自习',
    tags: ['学生', '学习', '自习', '晚自习', '专注'], isFeatured: true, isMemberOnly: false,
    recommendationWeight: 92, playCount: 14620, favoriteCount: 2380, completionRate: 0.76, updatedAt: '2026-06-05'
  },
  {
    id: 'exam-calm-station', title: '备考 | 深夜车站', subtitle: '考前稳定空间',
    atmosphereText: '把焦虑放远一点，只看下一题。', durationSeconds: 5400, audioUrl: '',
    coverImageUrl: '/static/images/zhiyin-deep-station.png', visualType: 'image', category: '备考',
    tags: ['学生', '备考', '考前', '平静', '减少焦虑'], isFeatured: true, isMemberOnly: false,
    recommendationWeight: 88, playCount: 11890, favoriteCount: 1960, completionRate: 0.69, updatedAt: '2026-06-04'
  },
  {
    id: 'recite-clear-desk', title: '背书 | 清醒书桌', subtitle: '记忆陪伴空间',
    atmosphereText: '一遍一遍来，声音不用很满。', durationSeconds: 2700, audioUrl: '',
    coverImageUrl: '/static/images/zhiyin-ocean-sunset.png', visualType: 'image', category: '背书',
    tags: ['学生', '背书', '早读', '清醒'], isFeatured: false, isMemberOnly: false,
    recommendationWeight: 78, playCount: 7630, favoriteCount: 920, completionRate: 0.64, updatedAt: '2026-06-07'
  },
  {
    id: 'nap-reset', title: '午休 | 轻轻恢复', subtitle: '短时休息空间',
    atmosphereText: '闭上眼睛，给下午留一点力气。', durationSeconds: 1800, audioUrl: '',
    coverImageUrl: '/static/images/zhiyin-forest-cabin.png', visualType: 'image', category: '午休',
    tags: ['学生', '午休', '放松', '恢复精力', '学习恢复'], isFeatured: false, isMemberOnly: false,
    recommendationWeight: 74, playCount: 6820, favoriteCount: 860, completionRate: 0.61, updatedAt: '2026-06-03'
  },
  {
    id: 'ocean-relax', title: '海边 | 日落放松', subtitle: '傍晚放松空间',
    atmosphereText: '让一天慢慢退到远处。', durationSeconds: 5400, audioUrl: '',
    coverImageUrl: '/static/images/zhiyin-ocean-sunset.png', visualType: 'image', category: '放松独处',
    tags: ['通用', '放松独处', '放松', '自然氛围'], isFeatured: true, isMemberOnly: false,
    recommendationWeight: 84, playCount: 10240, favoriteCount: 1580, completionRate: 0.66, updatedAt: '2026-06-02'
  }
];