import type { SceneConfig, SceneMode } from '../services/scene-configs';

export const demoSceneConfigs: SceneConfig[] = [
  scene('study-focus', '学习专注', 'both', '核心场景', '写作业、自习、备考、背书', '学习', 10, ['学习', '写作业', '自习', '晚自习', '备考', '背书', '专注'], true, true, true),
  scene('deep-work', '深度工作', 'normal', '核心场景', '办公、阅读、长时间专注', '工作', 20, ['工作', '办公', '阅读', '深度工作', '专注'], true, true, false),
  scene('sleep-aid', '睡前助眠', 'both', '核心场景', '睡前、午休、平静入睡', '睡前', 30, ['睡前', '助眠', '入睡', '午休', '平静'], true, true, true),
  scene('relax-recovery', '放松恢复', 'both', '核心场景', '下班、独处、情绪恢复', '放松', 40, ['放松', '恢复精力', '放松独处', '减少焦虑'], true, true, false),
  scene('late-night', '深夜陪伴', 'normal', '情绪场景', '失眠、独处、深夜陪伴', '深夜', 50, ['深夜', '深夜失眠', '失眠', '陪伴感', '独处'], false, true, false),
  scene('parent-child-sleep', '亲子睡前', 'normal', '家庭场景', '父母为孩子选择的睡前音乐', '亲子睡前', 60, ['亲子睡前', '亲子', '儿童', '父母', '睡前'], false, true, false),
  scene('nature-ambient', '自然氛围', 'both', '氛围场景', '雨夜、森林、海边、湖畔', '自然氛围', 70, ['自然氛围', '雨夜', '森林', '海边', '湖畔'], false, true, false)
];
function scene(id: string, name: string, mode: SceneMode, groupName: string, intro: string, query: string, sortOrder: number, matchTags: string[], showOnHome: boolean, showOnScenePage: boolean, showOnStudentPage: boolean): SceneConfig {
  return { id, name, mode, groupName, intro, query, sortOrder, defaultSort: 'featured', visibleSorts: ['featured', 'latest', 'hot'], matchTags: Array.from(new Set([query, name, ...matchTags])), status: 'enabled', showOnHome, showOnScenePage, showOnStudentPage };
}