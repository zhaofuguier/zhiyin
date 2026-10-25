// Editorial presentation from confirmed content form only. Never infer from titles or tags.
export function contentExperience(contentForm?: string) {
  switch (contentForm) {
    case 'silent-companion':
      return { label: '无声画面', description: '无音乐，主动开始后循环画面', startLabel: '开始陪伴', resumeLabel: '继续陪伴', nextLabel: '换个环境', guided: false };
    case 'instrumental-music':
      return { label: '纯音乐', description: '声音与画面陪伴', startLabel: '播放', resumeLabel: '继续播放', nextLabel: '下一首', guided: false };
    case 'nature-sound':
      return { label: '自然声音', description: '让环境声音陪你停留', startLabel: '播放', resumeLabel: '继续播放', nextLabel: '换个环境', guided: false };
    case 'steady-noise':
      return { label: '稳定噪声', description: '选择适合自己的背景声音', startLabel: '播放', resumeLabel: '继续播放', nextLabel: '换个环境', guided: false };
    case 'guided-audio':
      return { label: '引导音频', description: '跟随引导，结束后停止，不自动循环', startLabel: '开始引导', resumeLabel: '继续引导', nextLabel: '换个环境', guided: true };
    default:
      return { label: '类型待标注', description: '声音类型尚未标注，请查看内容介绍', startLabel: '播放', resumeLabel: '继续播放', nextLabel: '下一条', guided: false };
  }
}

export function contentPlayLabel(contentForm: string | undefined, playing: boolean, position: number, duration: number) {
  if (playing) return '暂停';
  const experience = contentExperience(contentForm);
  if (experience.guided && duration > 0 && position >= duration) return '重新开始';
  return position > 0 ? experience.resumeLabel : experience.startLabel;
}
