import * as fs from 'fs';
import * as path from 'path';
import {
  parse,
  Kind,
  ObjectTypeDefinitionNode,
  ObjectTypeExtensionNode,
  InputObjectTypeDefinitionNode,
  EnumTypeDefinitionNode,
  FieldDefinitionNode,
} from 'graphql';

/**
 * Additive Post Report contract (Ticket 02).
 *
 * Guards that `reportPost` and `ReportPostInput` exist as specified while
 * every pre-existing Post operation, field, and enum value keeps its
 * original shape.
 */
describe('Post Report GraphQL Schema Contract (Additive & Backward Compatible)', () => {
  const postsDoc = parse(fs.readFileSync(path.join(__dirname, 'posts.graphql'), 'utf8'));
  const postsEnumsDoc = parse(fs.readFileSync(path.join(__dirname, 'posts-enums.graphql'), 'utf8'));

  function fieldTypeName(field: FieldDefinitionNode): string {
    let type = field.type;
    while (type.kind === Kind.NON_NULL_TYPE || type.kind === Kind.LIST_TYPE) {
      type = type.type;
    }
    return type.name.value;
  }

  function isNonNull(field: FieldDefinitionNode): boolean {
    return field.type.kind === Kind.NON_NULL_TYPE;
  }

  it('adds the reportPost mutation returning Boolean! with ReportPostInput!', () => {
    const mutationExt = postsDoc.definitions.find(
      (d): d is ObjectTypeExtensionNode => d.kind === Kind.OBJECT_TYPE_EXTENSION && d.name.value === 'Mutation',
    );
    expect(mutationExt).toBeDefined();

    const reportPost = mutationExt!.fields?.find((f) => f.name.value === 'reportPost');
    expect(reportPost).toBeDefined();
    expect(fieldTypeName(reportPost!)).toBe('Boolean');
    expect(isNonNull(reportPost!)).toBe(true);
    expect(reportPost!.arguments).toHaveLength(1);
    expect(reportPost!.arguments![0].name.value).toBe('input');
    expect(fieldTypeName(reportPost!.arguments![0] as unknown as FieldDefinitionNode)).toBe('ReportPostInput');
    expect(reportPost!.arguments![0].type.kind).toBe(Kind.NON_NULL_TYPE);
  });

  it('defines ReportPostInput with postId, reason, and optional details', () => {
    const input = postsDoc.definitions.find(
      (d): d is InputObjectTypeDefinitionNode =>
        d.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION && d.name.value === 'ReportPostInput',
    );
    expect(input).toBeDefined();

    const fields = new Map(input!.fields?.map((f) => [f.name.value, f]) ?? []);
    expect([...fields.keys()].sort()).toEqual(['details', 'postId', 'reason']);

    expect(fieldTypeName(fields.get('postId')!)).toBe('ID');
    expect(isNonNull(fields.get('postId')!)).toBe(true);

    expect(fieldTypeName(fields.get('reason')!)).toBe('ReportReason');
    expect(isNonNull(fields.get('reason')!)).toBe(true);

    expect(fieldTypeName(fields.get('details')!)).toBe('String');
    expect(isNonNull(fields.get('details')!)).toBe(false);
  });

  it('preserves every existing Query and Mutation operation', () => {
    const queryExt = postsDoc.definitions.find(
      (d): d is ObjectTypeExtensionNode => d.kind === Kind.OBJECT_TYPE_EXTENSION && d.name.value === 'Query',
    );
    const mutationExt = postsDoc.definitions.find(
      (d): d is ObjectTypeExtensionNode => d.kind === Kind.OBJECT_TYPE_EXTENSION && d.name.value === 'Mutation',
    );

    const queryNames = queryExt!.fields?.map((f) => f.name.value) ?? [];
    expect(queryNames).toEqual(
      expect.arrayContaining([
        'post',
        'rescuePostDetail',
        'lostPostDetail',
        'adoptionPostDetail',
        'productPostDetail',
        'helpFeed',
        'adoptFeed',
        'marketFeed',
        'homeFeed',
        'mySavedPosts',
        'myPosts',
      ]),
    );

    const mutationNames = mutationExt!.fields?.map((f) => f.name.value) ?? [];
    expect(mutationNames).toEqual(
      expect.arrayContaining([
        'createRescuePost',
        'createLostPost',
        'createAdoptionPost',
        'createProductPost',
        'deletePost',
        'toggleUpvote',
        'toggleSave',
        'updatePostStatus',
        'recordView',
        'reportPost',
      ]),
    );
  });

  it('preserves the existing Post type fields and nullability', () => {
    const postType = postsDoc.definitions.find(
      (d): d is ObjectTypeDefinitionNode => d.kind === Kind.OBJECT_TYPE_DEFINITION && d.name.value === 'Post',
    );
    expect(postType).toBeDefined();

    const fields = new Map(postType!.fields?.map((f) => [f.name.value, f]) ?? []);
    const nonNullFields = [
      'id',
      'creator',
      'postType',
      'title',
      'description',
      'status',
      'moderationStatus',
      'city',
      'upvoteCount',
      'saveCount',
      'viewCount',
      'commentCount',
      'effectiveScore',
      'isUpvotedByMe',
      'isSavedByMe',
      'media',
      'createdAt',
      'updatedAt',
    ];
    for (const name of nonNullFields) {
      expect({ name, nonNull: fields.has(name) && isNonNull(fields.get(name)!) }).toEqual({ name, nonNull: true });
    }

    const nullableFields = ['urgency', 'areaName', 'coordinates', 'marketCategory'];
    for (const name of nullableFields) {
      expect({ name, nullable: fields.has(name) && !isNonNull(fields.get(name)!) }).toEqual({ name, nullable: true });
    }
  });

  it('preserves every existing ReportReason value', () => {
    const reportReason = postsEnumsDoc.definitions.find(
      (d): d is EnumTypeDefinitionNode => d.kind === Kind.ENUM_TYPE_DEFINITION && d.name.value === 'ReportReason',
    );
    expect(reportReason).toBeDefined();
    expect(reportReason!.values?.map((v) => v.name.value)).toEqual([
      'UNRELATED_TO_ANIMALS',
      'SPAM',
      'INAPPROPRIATE_CONTENT',
      'SCAM',
      'DUPLICATE',
      'OTHER',
    ]);
  });

  it('leaves the PostReport result type available unchanged', () => {
    const postReport = postsDoc.definitions.find(
      (d): d is ObjectTypeDefinitionNode => d.kind === Kind.OBJECT_TYPE_DEFINITION && d.name.value === 'PostReport',
    );
    expect(postReport).toBeDefined();
    const fields = new Map(postReport!.fields?.map((f) => [f.name.value, f]) ?? []);
    expect([...fields.keys()].sort()).toEqual(['createdAt', 'details', 'id', 'postId', 'reason']);
  });
});
