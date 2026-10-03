/**
 * edit_dsl 工具测试
 *
 * 覆盖场景：
 * - create_feature / add_node / update_node / delete_node
 * - add_edge / delete_edge
 * - add_file / update_file / delete_file
 * - add_expected_api / update_expected_api / delete_expected_api
 * - set_node_semantic
 * - batch_move_nodes / batch_update_style / batch_delete_nodes
 * - 节点增强属性（type/description/status/shape/swimlane）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createFeature } from '../../src/application/design/dsl_ops/feature_ops.js';
import { addNode, updateNode, deleteNode } from '../../src/application/design/dsl_ops/node_ops.js';
import { addEdge, deleteEdge } from '../../src/application/design/dsl_ops/edge_ops.js';
import { addFile, updateFile, deleteFile } from '../../src/application/design/dsl_ops/file_ops.js';
import { addExpectedApi, updateExpectedApi, deleteExpectedApi, setNodeSemantic } from '../../src/application/design/dsl_ops/api_ops.js';
import { clearAllFeatures, getDSL } from '../../src/infrastructure/storage.js';

describe('edit_dsl - 节点增强属性', () => {
  beforeEach(() => clearAllFeatures());
  afterEach(() => clearAllFeatures());

  it('add_node 支持 shapes 形状卡 + 非法 type 拒绝', () => {
    createFeature({ feature: 'test_shapes' });
    addNode({
      feature: 'test_shapes',
      node_id: 'port_in',
      label: '进料口',
      layer: 'detail',
      shapes: {
        in: { type: 'object', properties: { token: { type: 'string' } }, required: ['token'] },
        out: { type: 'string' },
      },
    });
    const node = getDSL('test_shapes')!.geometry.nodes[0];
    expect(node.shapes?.in?.type).toBe('object');
    expect(node.shapes?.out?.type).toBe('string');

    // 非法 type 递归拒绝（嵌套 properties 内也校验）
    expect(() =>
      addNode({
        feature: 'test_shapes',
        node_id: 'bad',
        shapes: { in: { type: 'object', properties: { x: { type: 'str' as never } } } },
      }),
    ).toThrow(/shapes\.in\.properties\.x\.type/);
  });

  it('update_node 修改 shapes；null 清除', () => {
    createFeature({ feature: 'test_shapes_upd' });
    addNode({ feature: 'test_shapes_upd', node_id: 'n1', label: '节点' });

    updateNode({
      feature: 'test_shapes_upd',
      node_id: 'n1',
      shapes: { out: { type: 'array', items: { type: 'integer' } } },
    });
    expect(getDSL('test_shapes_upd')!.geometry.nodes[0].shapes?.out?.items?.type).toBe('integer');

    updateNode({ feature: 'test_shapes_upd', node_id: 'n1', shapes: null });
    expect(getDSL('test_shapes_upd')!.geometry.nodes[0].shapes).toBeUndefined();
  });

  it('add_node 支持 type/description/status/shape/swimlane', () => {
    createFeature({ feature: 'test_node_props' });
    addNode({
      feature: 'test_node_props',
      node_id: 'n1',
      label: '服务层',
      type: 'service',
      description: '用户认证服务',
      status: 'in_progress',
      shape: 'rounded',
      swimlane: 'backend',
      x: 100,
      y: 200,
    });

    const dsl = getDSL('test_node_props')!;
    const node = dsl.geometry.nodes[0];
    expect(node.type).toBe('service');
    expect(node.description).toBe('用户认证服务');
    expect(node.status).toBe('in_progress');
    expect(node.style?.shape).toBe('rounded');
    expect(node.swimlane).toBe('backend');
    expect(node.x).toBe(100);
    expect(node.y).toBe(200);
  });

  it('update_node 可以修改 status/type/description', () => {
    createFeature({ feature: 'test_update_props' });
    addNode({ feature: 'test_update_props', node_id: 'n1', label: '节点1' });

    updateNode({
      feature: 'test_update_props',
      node_id: 'n1',
      status: 'done',
      type: 'database',
      description: '用户数据库',
      shape: 'circle',
    });

    const dsl = getDSL('test_update_props')!;
    const node = dsl.geometry.nodes[0];
    expect(node.status).toBe('done');
    expect(node.type).toBe('database');
    expect(node.description).toBe('用户数据库');
    expect(node.style?.shape).toBe('circle');
  });

  it('add_node / update_node 支持 layer 与 host（职责分层）', () => {
    createFeature({ feature: 'test_layer' });
    addNode({ feature: 'test_layer', node_id: 'main1', label: '主干' });
    addNode({
      feature: 'test_layer',
      node_id: 'err1',
      label: '异常处理',
      layer: 'error',
      host: 'main1',
    });

    let dsl = getDSL('test_layer')!;
    const err = dsl.geometry.nodes.find((n) => n.id === 'err1')!;
    expect(err.layer).toBe('error');
    expect(err.host).toBe('main1');

    // update：改层 + 换宿主
    addNode({ feature: 'test_layer', node_id: 'main2', label: '主干2' });
    updateNode({ feature: 'test_layer', node_id: 'err1', layer: 'detail', host: 'main2' });
    dsl = getDSL('test_layer')!;
    const err2 = dsl.geometry.nodes.find((n) => n.id === 'err1')!;
    expect(err2.layer).toBe('detail');
    expect(err2.host).toBe('main2');

    // null 清除 layer/host → 回到 main 层
    updateNode({ feature: 'test_layer', node_id: 'err1', layer: null, host: null });
    dsl = getDSL('test_layer')!;
    const err3 = dsl.geometry.nodes.find((n) => n.id === 'err1')!;
    expect(err3.layer).toBeUndefined();
    expect(err3.host).toBeUndefined();
  });

  it('add_node / update_node 校验 host 必须存在', () => {
    createFeature({ feature: 'test_layer_host' });
    addNode({ feature: 'test_layer_host', node_id: 'm', label: '主干' });
    expect(() =>
      addNode({ feature: 'test_layer_host', node_id: 'x', layer: 'error', host: 'ghost' }),
    ).toThrow(/host 节点 "ghost" 不存在/);
    expect(() =>
      updateNode({ feature: 'test_layer_host', node_id: 'm', host: 'ghost' }),
    ).toThrow(/host 节点 "ghost" 不存在/);
  });

  it('add_edge 支持显式 layer', () => {
    createFeature({ feature: 'test_edge_layer' });
    addNode({ feature: 'test_edge_layer', node_id: 'a' });
    addNode({ feature: 'test_edge_layer', node_id: 'b', layer: 'error', host: 'a' });
    addEdge({ feature: 'test_edge_layer', edge_id: 'e1', from: 'a', to: 'b', layer: 'error' });
    const dsl = getDSL('test_edge_layer')!;
    expect(dsl.geometry.edges![0].layer).toBe('error');
  });
});

describe('edit_dsl - 语义层编辑', () => {
  beforeEach(() => clearAllFeatures());
  afterEach(() => clearAllFeatures());

  it('add_file 添加语义文件', () => {
    createFeature({ feature: 'test_add_file' });
    addFile({
      feature: 'test_add_file',
      file_id: 'f1',
      path: 'service/user.go',
      responsibility: '用户服务',
      status: 'draft',
    });

    const dsl = getDSL('test_add_file')!;
    expect(dsl.semantic!.files).toHaveLength(1);
    expect(dsl.semantic!.files[0].id).toBe('f1');
    expect(dsl.semantic!.files[0].path).toBe('service/user.go');
    expect(dsl.semantic!.files[0].responsibility).toBe('用户服务');
    expect(dsl.semantic!.files[0].status).toBe('draft');
  });

  it('update_file 修改文件属性', () => {
    createFeature({ feature: 'test_update_file' });
    addFile({ feature: 'test_update_file', file_id: 'f1', path: 'a.go', responsibility: '原职责' });

    updateFile({
      feature: 'test_update_file',
      file_id: 'f1',
      path: 'b.go',
      responsibility: '新职责',
      status: 'done',
    });

    const dsl = getDSL('test_update_file')!;
    expect(dsl.semantic!.files[0].path).toBe('b.go');
    expect(dsl.semantic!.files[0].responsibility).toBe('新职责');
    expect(dsl.semantic!.files[0].status).toBe('done');
  });

  it('delete_file 删除文件', () => {
    createFeature({ feature: 'test_delete_file' });
    addFile({ feature: 'test_delete_file', file_id: 'f1', path: 'a.go', responsibility: 'a' });
    addFile({ feature: 'test_delete_file', file_id: 'f2', path: 'b.go', responsibility: 'b' });

    deleteFile({ feature: 'test_delete_file', file_id: 'f1' });

    const dsl = getDSL('test_delete_file')!;
    expect(dsl.semantic!.files).toHaveLength(1);
    expect(dsl.semantic!.files[0].id).toBe('f2');
  });

  it('add_expected_api 添加 API', () => {
    createFeature({ feature: 'test_add_api' });
    addFile({ feature: 'test_add_api', file_id: 'f1', path: 'a.go', responsibility: 'a' });

    addExpectedApi({
      feature: 'test_add_api',
      file_id: 'f1',
      signature: 'Login(username string) (string, error)',
      notes: '登录接口',
    });

    const dsl = getDSL('test_add_api')!;
    expect(dsl.semantic!.files[0].expected_apis).toHaveLength(1);
    expect(dsl.semantic!.files[0].expected_apis![0].signature).toContain('Login');
    expect(dsl.semantic!.files[0].expected_apis![0].notes).toBe('登录接口');
  });

  it('update_expected_api 修改 API 签名', () => {
    createFeature({ feature: 'test_update_api' });
    addFile({ feature: 'test_update_api', file_id: 'f1', path: 'a.go', responsibility: 'a' });
    addExpectedApi({ feature: 'test_update_api', file_id: 'f1', signature: 'OldFunc()' });

    updateExpectedApi({
      feature: 'test_update_api',
      file_id: 'f1',
      signature: 'OldFunc()',
      new_signature: 'NewFunc(id int) error',
      notes: '新函数',
    });

    const dsl = getDSL('test_update_api')!;
    expect(dsl.semantic!.files[0].expected_apis![0].signature).toBe('NewFunc(id int) error');
    expect(dsl.semantic!.files[0].expected_apis![0].notes).toBe('新函数');
  });

  it('delete_expected_api 删除 API', () => {
    createFeature({ feature: 'test_delete_api' });
    addFile({ feature: 'test_delete_api', file_id: 'f1', path: 'a.go', responsibility: 'a' });
    addExpectedApi({ feature: 'test_delete_api', file_id: 'f1', signature: 'Func1()' });
    addExpectedApi({ feature: 'test_delete_api', file_id: 'f1', signature: 'Func2()' });

    deleteExpectedApi({ feature: 'test_delete_api', file_id: 'f1', signature: 'Func1()' });

    const dsl = getDSL('test_delete_api')!;
    expect(dsl.semantic!.files[0].expected_apis).toHaveLength(1);
    expect(dsl.semantic!.files[0].expected_apis![0].signature).toBe('Func2()');
  });
});

describe('edit_dsl - 节点语义绑定', () => {
  beforeEach(() => clearAllFeatures());
  afterEach(() => clearAllFeatures());

  it('set_node_semantic 绑定节点与文件并同步状态', () => {
    createFeature({ feature: 'test_bind' });
    addNode({ feature: 'test_bind', node_id: 'n1', label: '服务节点', status: 'draft' });
    addFile({ feature: 'test_bind', file_id: 'f1', path: 'service.go', responsibility: '服务', status: 'done' });

    setNodeSemantic({ feature: 'test_bind', node_id: 'n1', file_id: 'f1', sync_status: true });

    const dsl = getDSL('test_bind')!;
    expect(dsl.geometry.nodes[0].status).toBe('done');
    expect(dsl.semantic!.files[0].status).toBe('done');
  });

  it('set_node_semantic 不同步状态', () => {
    createFeature({ feature: 'test_bind_nosync' });
    addNode({ feature: 'test_bind_nosync', node_id: 'n1', label: '节点', status: 'draft' });
    addFile({ feature: 'test_bind_nosync', file_id: 'f1', path: 'a.go', responsibility: 'a', status: 'done' });

    setNodeSemantic({ feature: 'test_bind_nosync', node_id: 'n1', file_id: 'f1', sync_status: false });

    const dsl = getDSL('test_bind_nosync')!;
    expect(dsl.geometry.nodes[0].status).toBe('draft');
    expect(dsl.semantic!.files[0].status).toBe('done');
  });
});
