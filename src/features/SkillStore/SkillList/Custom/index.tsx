'use client';

import isEqual from 'fast-deep-equal';
import { memo, useMemo } from 'react';

import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors, pluginSelectors } from '@/store/tool/selectors';

import AgentSkillItem from '../AgentSkillItem';
import Empty from '../Empty';
import { gridStyles } from '../style';
import Item from './Item';

export const CustomList = memo(() => {
  const customPlugins = useToolStore(pluginSelectors.installedCustomPluginMetaList, isEqual);
  // [enterprise-fork] 组织目录里 GitHub 旧记录可能仍是 source=market，Custom 页要全部列出
  const agentSkills = useToolStore(agentSkillsSelectors.getAgentSkills, isEqual);
  const searchKeywords = useToolStore((s) => s.customPluginSearchKeywords || '');
  const useFetchAgentSkills = useToolStore((s) => s.useFetchAgentSkills);
  useFetchAgentSkills(true);

  const filteredPlugins = useMemo(() => {
    const lowerKeywords = searchKeywords.toLowerCase().trim();
    if (!lowerKeywords) return customPlugins;

    return customPlugins.filter((plugin) => {
      const title = plugin.title?.toLowerCase() || '';
      const identifier = plugin.identifier?.toLowerCase() || '';
      return title.includes(lowerKeywords) || identifier.includes(lowerKeywords);
    });
  }, [customPlugins, searchKeywords]);

  const filteredAgentSkills = useMemo(() => {
    const lowerKeywords = searchKeywords.toLowerCase().trim();
    if (!lowerKeywords) return agentSkills;

    return agentSkills.filter((skill) => {
      const name = skill.name?.toLowerCase() || '';
      const identifier = skill.identifier?.toLowerCase() || '';
      return name.includes(lowerKeywords) || identifier.includes(lowerKeywords);
    });
  }, [agentSkills, searchKeywords]);

  const hasSearchKeywords = Boolean(searchKeywords && searchKeywords.trim());

  if (filteredAgentSkills.length === 0 && filteredPlugins.length === 0) {
    return <Empty search={hasSearchKeywords} />;
  }

  return (
    <div className={gridStyles.grid}>
      {filteredAgentSkills.map((skill) => (
        <AgentSkillItem key={skill.id} skill={skill} />
      ))}
      {filteredPlugins.map((plugin) => (
        <Item
          avatar={plugin.avatar}
          description={plugin.description}
          identifier={plugin.identifier}
          key={plugin.identifier}
          title={plugin.title}
        />
      ))}
    </div>
  );
});

CustomList.displayName = 'CustomList';

export default CustomList;
