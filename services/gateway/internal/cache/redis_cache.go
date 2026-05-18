package cache

import (
	"context"
	"encoding/json"
	"time"

	"github.com/redis/go-redis/v9"
)

type RedisCache struct {
	rdb *redis.Client
	ttl time.Duration
}

func New(rdb *redis.Client, ttl time.Duration) *RedisCache {
	return &RedisCache{rdb: rdb, ttl: ttl}
}

// Get retrieves a cached value. Returns false if not found.
func (c *RedisCache) Get(ctx context.Context, key string, dest interface{}) bool {
	val, err := c.rdb.Get(ctx, key).Result()
	if err != nil {
		return false
	}
	return json.Unmarshal([]byte(val), dest) == nil
}

// Set stores a value in cache.
func (c *RedisCache) Set(ctx context.Context, key string, value interface{}) {
	data, err := json.Marshal(value)
	if err != nil {
		return
	}
	c.rdb.Set(ctx, key, data, c.ttl)
}

// Del removes a cached value.
func (c *RedisCache) Del(ctx context.Context, keys ...string) {
	c.rdb.Del(ctx, keys...)
}

// Common cache key patterns
func UserKey(id string) string    { return "nexe:cache:user:" + id }
func ProfileKey(id string) string { return "nexe:cache:profile:" + id }
func GuildKey(id string) string   { return "nexe:cache:guild:" + id }
func RolesKey(gid string) string  { return "nexe:cache:roles:" + gid }
