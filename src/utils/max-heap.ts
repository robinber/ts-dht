/**
 * A generic max heap implementation for efficient priority queue operations.
 * This implementation stores elements with their priorities and provides operations
 * for maintaining the heap property.
 */
export class MaxHeap<T> {
  private readonly heap: Array<{ priority: bigint; value: T }> = [];
  private readonly valueIds = new Set<string>();
  private readonly getValueId: (value: T) => string;

  /**
   * Create a new max heap
   * @param getValueId Function to get a unique identifier for each value
   */
  constructor(getValueId: (value: T) => string) {
    this.getValueId = getValueId;
  }

  /**
   * Get the number of elements in the heap
   */
  get size(): number {
    return this.heap.length;
  }

  /**
   * Check if the heap is empty
   */
  get isEmpty(): boolean {
    return this.heap.length === 0;
  }

  /**
   * Check if the heap has reached the specified capacity
   * @param capacity The capacity to check against
   */
  isFull(capacity: number): boolean {
    return this.heap.length >= capacity;
  }

  /**
   * Get the highest priority element without removing it
   */
  peek(): { priority: bigint; value: T } | undefined {
    return this.heap.length > 0 ? this.heap[0] : undefined;
  }

  /**
   * Check if the heap contains a value with the given id
   * @param valueId The value ID to check
   */
  has(valueId: string): boolean {
    return this.valueIds.has(valueId);
  }

  /**
   * Add a value to the heap with the given priority
   * @param priority The priority of the value
   * @param value The value to add
   * @returns true if the value was added, false if it already exists
   */
  push(priority: bigint, value: T): boolean {
    const valueId = this.getValueId(value);
    if (this.valueIds.has(valueId)) {
      return false;
    }

    this.heap.push({ priority, value });
    this.valueIds.add(valueId);
    this.heapifyUp(this.heap.length - 1);
    return true;
  }

  /**
   * Replace the highest priority element if the new element has higher priority
   * @param priority The priority of the new value
   * @param value The value to add
   * @returns true if the value was added, false if it wasn't (either already exists or has lower priority)
   */
  pushOrReplace(priority: bigint, value: T): boolean {
    const valueId = this.getValueId(value);
    if (this.valueIds.has(valueId)) {
      return false;
    }

    // If heap is not full or new priority is lower than the highest (since we use a max heap)
    if (this.heap.length === 0 || priority < this.heap[0].priority) {
      if (this.heap.length > 0) {
        const oldValueId = this.getValueId(this.heap[0].value);
        this.valueIds.delete(oldValueId);
        this.heap[0] = { priority, value };
        this.valueIds.add(valueId);
        this.heapifyDown(0);
      } else {
        this.heap.push({ priority, value });
        this.valueIds.add(valueId);
      }
      return true;
    }

    return false;
  }

  /**
   * Remove and return the highest priority element
   */
  pop(): { priority: bigint; value: T } | undefined {
    if (this.heap.length === 0) {
      return undefined;
    }

    const result = this.heap[0];
    const valueId = this.getValueId(result.value);
    this.valueIds.delete(valueId);

    if (this.heap.length === 1) {
      return this.heap.pop();
    }

    // Move the last element to the root and maintain heap property
    const lastItem = this.heap.pop();
    if (lastItem) {
      this.heap[0] = lastItem;
      this.heapifyDown(0);
    }

    return result;
  }

  /**
   * Get all values from the heap in ascending order of priority
   * This is useful for distance-based heaps where smaller distances should come first
   */
  values(): T[] {
    const heapCopy = [...this.heap];

    // Sort the heap by priority (ascending order)
    heapCopy.sort((a, b) => Number(a.priority - b.priority));

    // Extract values in sorted order
    return heapCopy.map((item) => item.value);
  }

  /**
   * Clear all elements from the heap
   */
  clear(): void {
    this.heap.length = 0;
    this.valueIds.clear();
  }

  /**
   * Restore the heap property by moving an element up the tree
   * @param startIndex The index of the element to move up
   */
  private heapifyUp(startIndex: number): void {
    let currentIndex = startIndex;

    while (currentIndex > 0) {
      const parentIndex = Math.floor((currentIndex - 1) / 2);
      if (this.heap[parentIndex].priority < this.heap[currentIndex].priority) {
        // Swap with parent
        [this.heap[parentIndex], this.heap[currentIndex]] = [
          this.heap[currentIndex],
          this.heap[parentIndex],
        ];
        currentIndex = parentIndex;
      } else {
        break;
      }
    }
  }

  /**
   * Restore the heap property by moving an element down the tree
   * @param startIndex The index of the element to move down
   */
  private heapifyDown(startIndex: number): void {
    const heapSize = this.heap.length;
    let currentIndex = startIndex;

    while (true) {
      const leftChildIndex = 2 * currentIndex + 1;
      const rightChildIndex = 2 * currentIndex + 2;
      let largestIndex = currentIndex;

      if (
        leftChildIndex < heapSize &&
        this.heap[leftChildIndex].priority > this.heap[largestIndex].priority
      ) {
        largestIndex = leftChildIndex;
      }

      if (
        rightChildIndex < heapSize &&
        this.heap[rightChildIndex].priority > this.heap[largestIndex].priority
      ) {
        largestIndex = rightChildIndex;
      }

      if (largestIndex !== currentIndex) {
        [this.heap[currentIndex], this.heap[largestIndex]] = [
          this.heap[largestIndex],
          this.heap[currentIndex],
        ];
        currentIndex = largestIndex;
      } else {
        break;
      }
    }
  }
}
