import * as fs from 'fs';
import * as path from 'path';
import { parse, Kind, ObjectTypeDefinitionNode, FieldDefinitionNode, InputObjectTypeDefinitionNode } from 'graphql';

describe('Comments GraphQL Schema Contract (Additive & Backward Compatibility)', () => {
  const COMMENTS_GRAPHQL_FILE = path.join(__dirname, 'comments.graphql');
  const POSTS_GRAPHQL_FILE = path.join(__dirname, '../posts/posts.graphql');

  it('parses comments.graphql and verifies all required additive types and operations', () => {
    const source = fs.readFileSync(COMMENTS_GRAPHQL_FILE, 'utf8');
    const doc = parse(source);

    const typeNames = doc.definitions
      .filter((d): d is ObjectTypeDefinitionNode => d.kind === Kind.OBJECT_TYPE_DEFINITION)
      .map((d) => d.name.value);

    expect(typeNames).toContain('Comment');
    expect(typeNames).toContain('CommentEdge');
    expect(typeNames).toContain('CommentConnection');

    const inputNames = doc.definitions
      .filter((d): d is InputObjectTypeDefinitionNode => d.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION)
      .map((d) => d.name.value);

    expect(inputNames).toContain('CreateCommentInput');
    expect(inputNames).toContain('CreateReplyInput');
  });

  it('verifies Comment type has replyCount, parentId, and nullable author for tombstones', () => {
    const source = fs.readFileSync(COMMENTS_GRAPHQL_FILE, 'utf8');
    const doc = parse(source);

    const commentType = doc.definitions.find(
      (d): d is ObjectTypeDefinitionNode => d.kind === Kind.OBJECT_TYPE_DEFINITION && d.name.value === 'Comment',
    );

    expect(commentType).toBeDefined();

    // replyCount: Int!
    const replyCountField = commentType!.fields?.find((f) => f.name.value === 'replyCount');
    expect(replyCountField).toBeDefined();
    expect(replyCountField!.type.kind).toBe(Kind.NON_NULL_TYPE);

    // parentId: ID (nullable)
    const parentIdField = commentType!.fields?.find((f) => f.name.value === 'parentId');
    expect(parentIdField).toBeDefined();
    expect(parentIdField!.type.kind).toBe(Kind.NAMED_TYPE);

    // author: User (nullable for tombstones)
    const authorField = commentType!.fields?.find((f) => f.name.value === 'author');
    expect(authorField).toBeDefined();
    expect(authorField!.type.kind).toBe(Kind.NAMED_TYPE);

    // boostCount: Int!
    const boostCountField = commentType!.fields?.find((f) => f.name.value === 'boostCount');
    expect(boostCountField).toBeDefined();
    expect(boostCountField!.type.kind).toBe(Kind.NON_NULL_TYPE);

    // isBoostedByMe: Boolean!
    const isBoostedByMeField = commentType!.fields?.find((f) => f.name.value === 'isBoostedByMe');
    expect(isBoostedByMeField).toBeDefined();
    expect(isBoostedByMeField!.type.kind).toBe(Kind.NON_NULL_TYPE);

    // isPinned: Boolean!
    const isPinnedField = commentType!.fields?.find((f) => f.name.value === 'isPinned');
    expect(isPinnedField).toBeDefined();
    expect(isPinnedField!.type.kind).toBe(Kind.NON_NULL_TYPE);
  });

  it('verifies ToggleCommentBoostPayload has commentId, isBoostedByMe, and boostCount', () => {
    const source = fs.readFileSync(COMMENTS_GRAPHQL_FILE, 'utf8');
    const doc = parse(source);

    const payloadType = doc.definitions.find(
      (d): d is ObjectTypeDefinitionNode =>
        d.kind === Kind.OBJECT_TYPE_DEFINITION && d.name.value === 'ToggleCommentBoostPayload',
    );

    expect(payloadType).toBeDefined();
    const fieldNames = payloadType!.fields?.map((f) => f.name.value) ?? [];
    expect(fieldNames).toContain('commentId');
    expect(fieldNames).toContain('isBoostedByMe');
    expect(fieldNames).toContain('boostCount');
  });

  it('verifies Query extends replies and Mutation extends createReply, deleteComment, and toggleCommentBoost', () => {
    const source = fs.readFileSync(COMMENTS_GRAPHQL_FILE, 'utf8');
    const doc = parse(source);

    const queryExt = doc.definitions.find((d) => d.kind === Kind.OBJECT_TYPE_EXTENSION && d.name.value === 'Query') as
      ObjectTypeDefinitionNode | undefined;
    expect(queryExt).toBeDefined();
    const queryFields = queryExt!.fields?.map((f) => f.name.value) ?? [];
    expect(queryFields).toContain('comments');
    expect(queryFields).toContain('replies');

    const mutationExt = doc.definitions.find(
      (d) => d.kind === Kind.OBJECT_TYPE_EXTENSION && d.name.value === 'Mutation',
    ) as ObjectTypeDefinitionNode | undefined;
    expect(mutationExt).toBeDefined();
    const mutationFields = mutationExt!.fields?.map((f) => f.name.value) ?? [];
    expect(mutationFields).toContain('createComment');
    expect(mutationFields).toContain('createReply');
    expect(mutationFields).toContain('deleteComment');
    expect(mutationFields).toContain('toggleCommentBoost');
    expect(mutationFields).toContain('pinComment');
    expect(mutationFields).toContain('unpinComment');
  });

  it('ensures Post in posts.graphql includes additive commentCount: Int!', () => {
    const source = fs.readFileSync(POSTS_GRAPHQL_FILE, 'utf8');
    const doc = parse(source);

    const postType = doc.definitions.find(
      (d): d is ObjectTypeDefinitionNode => d.kind === Kind.OBJECT_TYPE_DEFINITION && d.name.value === 'Post',
    );

    expect(postType).toBeDefined();
    const commentCountField = postType!.fields?.find((f: FieldDefinitionNode) => f.name.value === 'commentCount');
    expect(commentCountField).toBeDefined();
    // Non-null Int
    expect(commentCountField!.type.kind).toBe(Kind.NON_NULL_TYPE);
  });

  it('ensures existing post fields remain intact and unremoved', () => {
    const source = fs.readFileSync(POSTS_GRAPHQL_FILE, 'utf8');
    const doc = parse(source);

    const postType = doc.definitions.find(
      (d): d is ObjectTypeDefinitionNode => d.kind === Kind.OBJECT_TYPE_DEFINITION && d.name.value === 'Post',
    );

    const fieldNames = postType!.fields?.map((f) => f.name.value) ?? [];
    const expectedExistingFields = [
      'id',
      'creator',
      'postType',
      'title',
      'description',
      'status',
      'moderationStatus',
      'urgency',
      'city',
      'areaName',
      'coordinates',
      'marketCategory',
      'upvoteCount',
      'saveCount',
      'viewCount',
      'effectiveScore',
      'isUpvotedByMe',
      'isSavedByMe',
      'media',
      'createdAt',
      'updatedAt',
    ];

    for (const expected of expectedExistingFields) {
      expect(fieldNames).toContain(expected);
    }
  });
});
