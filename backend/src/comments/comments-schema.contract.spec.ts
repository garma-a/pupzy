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
